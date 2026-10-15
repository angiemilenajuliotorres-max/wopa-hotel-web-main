/**
 * Importa los datos de la web heredada (tablas en el esquema public) al esquema nuevo.
 * Ver ADR-013. Es idempotente: si un hotel o registro ya fue importado, lo omite.
 *
 * Supuestos (aprobados por WOPA, revisables en el panel):
 * - Los precios heredados son precios al público en USD. Tarifa neta = precio ÷ 1,30; margen 30 %.
 * - Los hoteles quedan publicados en modo "solicitud" (sin cupos cargados), como funcionan hoy.
 * - La política heredada retiene el anticipo (25 % del total) al cancelar.
 */
import { calcularNoche } from "@wopa/dominio/tarifas";
import { crearSlug, normalizar } from "@wopa/dominio/texto";

export { crearSlug, normalizar };

export interface ClienteSql {
  query<Fila = Record<string, any>>(sql: string, parametros?: unknown[]): Promise<{ rows: Fila[]; rowCount: number | null }>;
}

export interface ResultadoImportacion {
  hoteles: number;
  experiencias: number;
  reservas: number;
  cotizaciones: number;
  tickets: number;
  operacionesContables: number;
  eventosAuditoria: number;
  avisos: string[];
}

const MARGEN_BP = 3000;
const REDONDEO_USD = 100n;
const DIAS_DE_PRECIOS = 365;

const SERVICIOS: Record<string, string> = {
  "wifi": "wifi",
  "aire acondicionado": "aire_acondicionado",
  "desayuno incluido": "desayuno_incluido",
  "minibar": "minibar",
  "tv cable": "tv",
  "piscina": "piscina",
  "piscina infinita": "piscina",
  "gimnasio": "gimnasio",
  "restaurante": "restaurante",
  "restaurante gourmet": "restaurante",
  "restaurante 5 estrellas": "restaurante",
  "spa": "spa",
  "spa de lujo": "spa",
  "playa privada": "playa_privada",
  "recepcion 24/7": "recepcion_24h",
  "concierge": "concierge",
  "concierge 24/7": "concierge",
  "parqueo": "parqueo",
  "terraza": "terraza",
  "cocina": "cocina",
  "lavanderia": "lavanderia",
};

const CATEGORIAS: Record<string, string> = {
  "cultura": "cultural",
  "mar y naturaleza": "naturaleza",
  "navegacion": "naturaleza",
  "cultura y entretenimiento": "nocturna",
  "gastronomia": "gastronomia",
};

const ESTADOS_RESERVA: Record<string, string> = {
  pendiente_confirmacion: "solicitada",
  confirmada: "confirmada",
  rechazada: "rechazada",
  cancelada: "cancelada",
  completada: "completada",
};

const ESTADOS_COTIZACION: Record<string, string> = {
  pendiente: "pendiente",
  en_revision: "pendiente",
  generada_automatica: "pendiente",
  estimado_parcial: "pendiente",
  cotizada: "enviada",
  aceptada: "aceptada",
  rechazada: "descartada",
};

const ESTADOS_TICKET: Record<string, string> = { nuevo: "abierto", en_revision: "en_progreso", resuelto: "resuelto" };

/** Neta más alta cuyo precio al público (30 % + redondeo a 1 USD) no supera el precio heredado. */
export function netaDesdePrecioPublico(precioCentavos: bigint): bigint {
  let neta = (precioCentavos * 10_000n) / BigInt(10_000 + MARGEN_BP);
  const regla = { tipo: "porcentaje" as const, porcentajeBp: MARGEN_BP };
  while (neta > 1n && calcularNoche(neta, regla, REDONDEO_USD).ventaCentavos > precioCentavos) neta -= 1n;
  return neta;
}

function aCentavos(valor: unknown): bigint {
  return BigInt(Math.round(Number(valor) * 100));
}

async function existeTabla(db: ClienteSql, tabla: string): Promise<boolean> {
  const { rows } = await db.query<{ existe: boolean }>("SELECT to_regclass($1) IS NOT NULL AS existe", [`public.${tabla}`]);
  return rows[0].existe;
}

export async function importarLegado(db: ClienteSql, opciones: { correoAdmin: string; hoy?: string }): Promise<ResultadoImportacion> {
  const hoy = opciones.hoy ?? new Date().toISOString().slice(0, 10);
  const resultado: ResultadoImportacion = {
    hoteles: 0, experiencias: 0, reservas: 0, cotizaciones: 0, tickets: 0, operacionesContables: 0, eventosAuditoria: 0, avisos: [],
  };

  const admin = (await db.query<{ id: string }>(
    `SELECT u.id FROM identidad.usuarios u
     JOIN identidad.membresias m ON m.usuario_id = u.id AND m.rol = 'wopa_admin'
     WHERE u.correo = $1`,
    [opciones.correoAdmin],
  )).rows[0];
  if (!admin) throw new Error(`No existe un usuario wopa_admin con el correo ${opciones.correoAdmin}. Créalo con npm run admin:crear.`);

  if (!(await existeTabla(db, "tipos_habitacion"))) {
    resultado.avisos.push("No hay tablas de la web heredada en el esquema public: nada que importar.");
    return resultado;
  }

  const cartagena = (await db.query<{ id: string; latitud: string; longitud: string }>(
    "SELECT c.id, c.latitud, c.longitud FROM geo.ciudades c JOIN geo.ciudad_traducciones t ON t.ciudad_id = c.id WHERE t.slug = 'cartagena' AND t.idioma_codigo = 'es'",
  )).rows[0];
  const servicios = new Map(
    (await db.query<{ id: string; codigo: string }>("SELECT id, codigo FROM catalogo.servicios")).rows.map((fila) => [fila.codigo, fila.id]),
  );

  // ------------------------------------------------------------------ hoteles
  const hotelPorTipoLegado = new Map<number, { hotel: string; plan: string; habitacion: string }>();
  const tipos = (await db.query<{
    id: number; nombre: string; descripcion: string | null; capacidad_maxima: number; servicios: string | null; imagen_url: string | null;
  }>("SELECT id, nombre, descripcion, capacidad_maxima, servicios, imagen_url FROM public.tipos_habitacion ORDER BY id")).rows;

  for (const tipo of tipos) {
    const slug = crearSlug(tipo.nombre);
    const existente = (await db.query<{ hotel: string; plan: string; habitacion: string }>(
      `SELECT h.id AS hotel, p.id AS plan, t.id AS habitacion FROM catalogo.hoteles h
       JOIN tarifas.planes_tarifa p ON p.hotel_id = h.id AND p.codigo = 'base'
       JOIN catalogo.tipos_habitacion t ON t.hotel_id = h.id AND t.codigo = 'estandar'
       WHERE h.slug = $1`,
      [slug],
    )).rows[0];
    if (existente) {
      hotelPorTipoLegado.set(tipo.id, existente);
      continue;
    }

    const organizacion = (await db.query<{ id: string }>(
      "INSERT INTO identidad.organizaciones (nombre, tipo) VALUES ($1, 'hotel') RETURNING id", [tipo.nombre],
    )).rows[0].id;
    const hotel = (await db.query<{ id: string }>(
      `INSERT INTO catalogo.hoteles (organizacion_id, ciudad_id, slug, nombre, modo_reserva, moneda_codigo, zona_horaria,
         latitud, longitud, direccion, aceptado_por, aceptado_en)
       VALUES ($1, $2, $3, $4, 'solicitud', 'USD', 'America/Bogota', $5, $6, 'Cartagena de Indias (dirección por completar)', $7, now())
       RETURNING id`,
      [organizacion, cartagena.id, slug, tipo.nombre, cartagena.latitud, cartagena.longitud, admin.id],
    )).rows[0].id;

    if (tipo.descripcion) {
      await db.query("INSERT INTO catalogo.hotel_traducciones (hotel_id, idioma_codigo, descripcion) VALUES ($1, 'es', $2)", [hotel, tipo.descripcion]);
    }
    for (const nombreServicio of (tipo.servicios ?? "").split(",").map(normalizar).filter(Boolean)) {
      const codigo = SERVICIOS[nombreServicio];
      if (!codigo) {
        resultado.avisos.push(`${tipo.nombre}: servicio "${nombreServicio}" sin equivalente; no se importó.`);
        continue;
      }
      await db.query("INSERT INTO catalogo.hotel_servicios (hotel_id, servicio_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [hotel, servicios.get(codigo)]);
    }
    if (tipo.imagen_url?.startsWith("https://")) {
      await db.query("INSERT INTO catalogo.fotos (hotel_id, url) VALUES ($1, $2)", [hotel, tipo.imagen_url]);
    }

    const politica = (await db.query<{ id: string }>(
      "INSERT INTO tarifas.politicas_cancelacion (hotel_id, codigo) VALUES ($1, 'legado') RETURNING id", [hotel],
    )).rows[0].id;
    await db.query("INSERT INTO tarifas.politica_reglas (politica_id, dias_antes_llegada, penalizacion_bp) VALUES ($1, 0, 2500)", [politica]);
    const plan = (await db.query<{ id: string }>(
      "INSERT INTO tarifas.planes_tarifa (hotel_id, politica_cancelacion_id, codigo, anticipo_bp) VALUES ($1, $2, 'base', 2500) RETURNING id",
      [hotel, politica],
    )).rows[0].id;
    await db.query(
      "INSERT INTO tarifas.plan_tarifa_traducciones (plan_tarifa_id, idioma_codigo, nombre) VALUES ($1, 'es', 'Tarifa base'), ($1, 'en', 'Standard rate')",
      [plan],
    );
    const capacidad = Math.min(Math.max(tipo.capacidad_maxima ?? 4, 1), 12);
    const habitacion = (await db.query<{ id: string }>(
      "INSERT INTO catalogo.tipos_habitacion (hotel_id, codigo, capacidad_maxima) VALUES ($1, 'estandar', $2) RETURNING id",
      [hotel, capacidad],
    )).rows[0].id;
    await db.query(
      "INSERT INTO catalogo.tipo_habitacion_traducciones (tipo_habitacion_id, idioma_codigo, nombre) VALUES ($1, 'es', 'Habitación estándar'), ($1, 'en', 'Standard room')",
      [habitacion],
    );

    await db.query(
      `INSERT INTO tarifas.reglas_margen (hotel_id, tipo, porcentaje_bp, vigente_desde, motivo, creado_por)
       VALUES ($1, 'porcentaje', $2, $3, 'Migración desde la web heredada: margen supuesto del 30 % (ADR-013)', $4)`,
      [hotel, MARGEN_BP, hoy, admin.id],
    );

    // Tarifas heredadas por capacidad (2 y 4 personas) → neta por día para cada ocupación.
    const tarifas = (await db.query<{ capacidad_personas: number; precio_usd: string }>(
      "SELECT capacidad_personas, precio_usd FROM public.tarifas WHERE tipo_id = $1 ORDER BY capacidad_personas", [tipo.id],
    )).rows;
    for (let ocupacion = 1; ocupacion <= capacidad; ocupacion++) {
      const tarifa = tarifas.find((fila) => fila.capacidad_personas >= ocupacion) ?? tarifas.at(-1);
      if (!tarifa) break;
      const neta = netaDesdePrecioPublico(aCentavos(tarifa.precio_usd));
      await db.query(
        `INSERT INTO tarifas.precios_dia (hotel_id, plan_tarifa_id, tipo_habitacion_id, fecha, ocupacion, monto_neto_centavos)
         SELECT $1, $2, $3, d::date, $4, $5 FROM generate_series($6::date, $6::date + $7::int, '1 day') d`,
        [hotel, plan, habitacion, ocupacion, neta.toString(), hoy, DIAS_DE_PRECIOS - 1],
      );
    }
    if (tarifas.length === 0) resultado.avisos.push(`${tipo.nombre}: sin tarifas heredadas; cargar precios antes de vender.`);

    await db.query("UPDATE catalogo.hoteles SET estado = 'publicado' WHERE id = $1", [hotel]);
    await db.query(
      `INSERT INTO auditoria.eventos (entidad, entidad_id, accion, detalle, actor_tipo, actor_usuario_id)
       VALUES ('hotel', $1, 'importado', 'Importado de la web heredada con margen del 30 % y modo solicitud.', 'usuario', $2)`,
      [hotel, admin.id],
    );
    hotelPorTipoLegado.set(tipo.id, { hotel, plan, habitacion });
    resultado.hoteles++;
  }

  // ------------------------------------------------------------------ experiencias
  const experienciaPorLegado = new Map<number, string>();
  if (await existeTabla(db, "experiencias")) {
    const legado = (await db.query<{
      id: number; slug: string; nombre: string; categoria: string; descripcion: string; duracion: string | null;
      imagen_url: string | null; precio_usd: string | null; unidad_precio: string; activa: number;
    }>("SELECT id, slug, nombre, categoria, descripcion, duracion, imagen_url, precio_usd, unidad_precio, activa FROM public.experiencias ORDER BY id")).rows;
    for (const experiencia of legado) {
      const existente = (await db.query<{ id: string }>("SELECT id FROM experiencias.experiencias WHERE codigo = $1", [experiencia.slug])).rows[0];
      if (existente) {
        experienciaPorLegado.set(experiencia.id, existente.id);
        continue;
      }
      const id = (await db.query<{ id: string }>(
        `INSERT INTO experiencias.experiencias (ciudad_id, codigo, categoria, imagen_url, precio_centavos, moneda_codigo, unidad_precio, esta_activa)
         VALUES ($1, $2, $3, $4, $5, 'USD', $6, $7) RETURNING id`,
        [
          cartagena.id, experiencia.slug, CATEGORIAS[normalizar(experiencia.categoria)] ?? "otra",
          experiencia.imagen_url?.startsWith("https://") ? experiencia.imagen_url : null,
          experiencia.precio_usd === null ? null : aCentavos(experiencia.precio_usd).toString(),
          experiencia.unidad_precio === "grupo" ? "grupo" : "persona", Boolean(experiencia.activa),
        ],
      )).rows[0].id;
      await db.query(
        "INSERT INTO experiencias.experiencia_traducciones (experiencia_id, idioma_codigo, nombre, descripcion, duracion) VALUES ($1, 'es', $2, $3, $4)",
        [id, experiencia.nombre, experiencia.descripcion, experiencia.duracion],
      );
      experienciaPorLegado.set(experiencia.id, id);
      resultado.experiencias++;
    }
  }

  // ------------------------------------------------------------------ reservas (solicitudes)
  const reservaPorLegado = new Map<number, string>();
  if (await existeTabla(db, "solicitudes_reserva")) {
    const solicitudes = (await db.query<Record<string, any>>("SELECT * FROM public.solicitudes_reserva ORDER BY id")).rows;
    for (const solicitud of solicitudes) {
      const existente = (await db.query<{ id: string }>("SELECT id FROM reservas.reservas WHERE codigo = $1", [solicitud.codigo])).rows[0];
      if (existente) {
        reservaPorLegado.set(solicitud.id, existente.id);
        continue;
      }
      const destino = hotelPorTipoLegado.get(solicitud.tipo_id);
      const estado = ESTADOS_RESERVA[solicitud.estado];
      if (!destino || !estado || !/^WOPA-R-[A-F0-9]{16}$/.test(solicitud.codigo)) {
        resultado.avisos.push(`Reserva ${solicitud.codigo}: datos no reconocidos (hotel, estado o código); no se importó.`);
        continue;
      }
      const total = aCentavos(solicitud.subtotal_usd);
      const anticipo = aCentavos(solicitud.anticipo_usd);
      const entrada = new Date(solicitud.fecha_entrada).toISOString().slice(0, 10);
      const salida = new Date(solicitud.fecha_salida).toISOString().slice(0, 10);
      const reserva = (await db.query<{ id: string }>(
        `INSERT INTO reservas.reservas (codigo, hotel_id, estado, fecha_entrada, fecha_salida, idioma_codigo, moneda_codigo,
           total_venta_centavos, anticipo_centavos, titular_nombre, titular_correo, titular_telefono, solicitudes_especiales,
           politica_cancelacion, creado_en)
         VALUES ($1, $2, $3, $4, $5, 'es', 'USD', $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [
          solicitud.codigo, destino.hotel, estado, entrada, salida, total.toString(), (anticipo > total ? total : anticipo).toString(),
          String(solicitud.nombre).slice(0, 120), solicitud.correo, String(solicitud.telefono).slice(0, 30),
          [solicitud.solicitudes_especiales, solicitud.nota_admin && `Nota interna heredada: ${solicitud.nota_admin}`, solicitud.motivo_cancelacion && `Motivo de cancelación: ${solicitud.motivo_cancelacion}`].filter(Boolean).join("\n") || null,
          JSON.stringify({ origen: "legado", regla: "Se retiene el 100 % de lo abonado al cancelar", penalizacion_usd: Number(solicitud.monto_penalizacion_usd ?? 0) }),
          solicitud.created_at ?? new Date(),
        ],
      )).rows[0].id;
      const linea = (await db.query<{ id: string }>(
        "INSERT INTO reservas.reserva_lineas (reserva_id, hotel_id, tipo_habitacion_id, plan_tarifa_id, adultos) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [reserva, destino.hotel, destino.habitacion, destino.plan, Math.min(Math.max(Number(solicitud.numero_personas) || 1, 1), 12)],
      )).rows[0].id;
      const ventaNoche = aCentavos(solicitud.tarifa_noche_usd);
      const netaNoche = netaDesdePrecioPublico(ventaNoche);
      await db.query(
        `INSERT INTO reservas.reserva_noches (reserva_linea_id, fecha, monto_neto_centavos, margen_centavos)
         SELECT $1, d::date, $2, $3 FROM generate_series($4::date, $5::date - 1, '1 day') d`,
        [linea, netaNoche.toString(), (ventaNoche - netaNoche).toString(), entrada, salida],
      );
      reservaPorLegado.set(solicitud.id, reserva);
      resultado.reservas++;
    }
  }

  // ------------------------------------------------------------------ cotizaciones
  if (await existeTabla(db, "solicitudes_cotizacion")) {
    const cotizaciones = (await db.query<Record<string, any>>("SELECT * FROM public.solicitudes_cotizacion ORDER BY id")).rows;
    for (const cotizacion of cotizaciones) {
      const existe = (await db.query("SELECT 1 FROM experiencias.cotizaciones WHERE codigo = $1", [cotizacion.codigo])).rows[0];
      if (existe) continue;
      const fecha = (valor: unknown) => (valor ? new Date(valor as string).toISOString().slice(0, 10) : null);
      const id = (await db.query<{ id: string }>(
        `INSERT INTO experiencias.cotizaciones (codigo, nombre, correo, telefono, idioma_codigo, moneda_codigo, personas,
           fecha_entrada, fecha_salida, notas, estado, nota_admin, creado_en)
         VALUES ($1, $2, $3, $4, 'es', 'USD', $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [
          cotizacion.codigo, cotizacion.nombre, cotizacion.correo, cotizacion.telefono,
          Math.min(Math.max(Number(cotizacion.numero_personas) || 1, 1), 50), fecha(cotizacion.fecha_entrada), fecha(cotizacion.fecha_salida),
          cotizacion.notas, ESTADOS_COTIZACION[cotizacion.estado] ?? "pendiente", cotizacion.nota_admin, cotizacion.created_at ?? new Date(),
        ],
      )).rows[0].id;
      const hotel = cotizacion.tipo_id ? hotelPorTipoLegado.get(cotizacion.tipo_id)?.hotel : undefined;
      if (hotel) {
        await db.query(
          "INSERT INTO experiencias.cotizacion_lineas (cotizacion_id, concepto, hotel_id, descripcion, monto_centavos) VALUES ($1, 'hospedaje', $2, 'Hospedaje (importado)', $3)",
          [id, hotel, cotizacion.subtotal_hospedaje_usd === null ? null : aCentavos(cotizacion.subtotal_hospedaje_usd).toString()],
        );
      }
      const experiencia = cotizacion.experiencia_id ? experienciaPorLegado.get(cotizacion.experiencia_id) : undefined;
      if (experiencia) {
        await db.query(
          "INSERT INTO experiencias.cotizacion_lineas (cotizacion_id, concepto, experiencia_id, descripcion, monto_centavos) VALUES ($1, 'experiencia', $2, 'Experiencia (importada)', $3)",
          [id, experiencia, cotizacion.subtotal_experiencias_usd === null ? null : aCentavos(cotizacion.subtotal_experiencias_usd).toString()],
        );
      }
      resultado.cotizaciones++;
    }
  }

  // ------------------------------------------------------------------ mensajes de contacto → tickets
  if (await existeTabla(db, "mensajes_contacto")) {
    const mensajes = (await db.query<Record<string, any>>("SELECT * FROM public.mensajes_contacto ORDER BY id")).rows;
    for (const mensaje of mensajes) {
      const marca = `Código anterior: ${mensaje.codigo}`;
      const existe = (await db.query("SELECT 1 FROM soporte.ticket_mensajes WHERE autor = 'sistema' AND contenido = $1", [marca])).rows[0];
      if (existe) continue;
      const estado = ESTADOS_TICKET[mensaje.estado] ?? "abierto";
      const creado = mensaje.created_at ?? new Date();
      const numero = (await db.query<{ n: number }>("SELECT count(*)::int + 1 AS n FROM soporte.tickets")).rows[0].n;
      const ticket = (await db.query<{ id: string }>(
        `INSERT INTO soporte.tickets (codigo, categoria_codigo, estado, origen, asunto, idioma_codigo, solicitante_nombre,
           solicitante_correo, solicitante_telefono, vence_sla_en, creado_en, resuelto_en)
         VALUES ($1, 'otro', $2, 'legado', $3, 'es', $4, $5, $6, $7::timestamptz + interval '24 hours', $7, $8) RETURNING id`,
        [
          `TK-${String(numero).padStart(6, "0")}`, estado, String(mensaje.asunto).slice(0, 200).padEnd(3, "."), mensaje.nombre,
          mensaje.correo, mensaje.telefono, creado, estado === "resuelto" ? creado : null,
        ],
      )).rows[0].id;
      await db.query("INSERT INTO soporte.ticket_mensajes (ticket_id, autor, contenido) VALUES ($1, 'cliente', $2)", [ticket, mensaje.mensaje]);
      await db.query("INSERT INTO soporte.ticket_mensajes (ticket_id, autor, contenido) VALUES ($1, 'sistema', $2)", [ticket, marca]);
      if (mensaje.nota_admin) {
        await db.query(
          "INSERT INTO soporte.ticket_mensajes (ticket_id, autor, autor_usuario_id, contenido, es_nota_interna) VALUES ($1, 'equipo', $2, $3, true)",
          [ticket, admin.id, mensaje.nota_admin],
        );
      }
      resultado.tickets++;
    }
  }

  // ------------------------------------------------------------------ movimientos → asientos de partida doble
  if (await existeTabla(db, "movimientos_financieros")) {
    const movimientos = (await db.query<Record<string, any>>("SELECT * FROM public.movimientos_financieros ORDER BY id")).rows;
    for (const movimiento of movimientos) {
      const descripcion = `[legado #${movimiento.id}] ${movimiento.categoria}: ${movimiento.descripcion}`;
      const existe = (await db.query("SELECT 1 FROM pagos.asientos WHERE descripcion = $1", [descripcion])).rows[0];
      if (existe) continue;
      const monto = aCentavos(movimiento.monto_usd);
      const [debe, haber] = movimiento.tipo === "ingreso" ? ["caja_proveedor", "ingreso_otro"] : ["gasto_operativo", "caja_proveedor"];
      const reserva = movimiento.solicitud_reserva_id ? reservaPorLegado.get(movimiento.solicitud_reserva_id) ?? null : null;
      const fecha = new Date(movimiento.fecha).toISOString().slice(0, 10);
      await db.query(
        `INSERT INTO pagos.asientos (operacion_id, cuenta, monto_centavos, moneda_codigo, fecha, descripcion, reserva_id, creado_por)
         SELECT op, cuenta, monto, 'USD', $1, $2, $3, $4
         FROM (SELECT gen_random_uuid() AS op) o, (VALUES ($5, $6::bigint), ($7, -$6::bigint)) AS v (cuenta, monto)`,
        [fecha, descripcion, reserva, admin.id, debe, monto.toString(), haber],
      );
      resultado.operacionesContables++;
    }
  }

  // ------------------------------------------------------------------ bitácora
  if (await existeTabla(db, "actividad_sitio")) {
    const actividad = (await db.query<Record<string, any>>("SELECT * FROM public.actividad_sitio ORDER BY id")).rows;
    for (const evento of actividad) {
      const entidadId = `legado:${evento.id}`;
      const existe = (await db.query("SELECT 1 FROM auditoria.eventos WHERE entidad_id = $1", [entidadId])).rows[0];
      if (existe) continue;
      await db.query(
        `INSERT INTO auditoria.eventos (entidad, entidad_id, accion, antes, despues, detalle, actor_tipo, creado_en)
         VALUES ($1, $2, $3, $4, $5, $6, 'sistema', $7)`,
        [
          evento.entidad, entidadId, evento.tipo_evento,
          evento.estado_anterior ? JSON.stringify({ estado: evento.estado_anterior }) : null,
          JSON.stringify({ estado: evento.estado_nuevo, codigo: evento.codigo_entidad, monto_usd: evento.monto_usd }),
          `${evento.detalle ?? ""} (realizado por: ${evento.realizado_por})`.trim(), evento.created_at,
        ],
      );
      resultado.eventosAuditoria++;
    }
  }

  return resultado;
}
