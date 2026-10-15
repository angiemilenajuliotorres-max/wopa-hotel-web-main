/**
 * Catálogo y tarifas desde el panel de WOPA y la extranet de hoteles:
 * alta de hoteles (ADR-004), aceptación con margen obligatorio y ajustes de margen (ADR-008),
 * habitaciones, planes, tarifa neta y cupos por rango de fechas.
 */
import { crearSlug } from "@wopa/dominio/texto";
import { crearAlerta, registrarEvento } from "./auditoria.ts";
import { db, enTransaccion, ErrorNegocio, type Consulta } from "./conexion.ts";
import { esWopa, hotelesDe, type SesionActiva } from "./identidad.ts";

export type ReglaMargenEntrada = { tipo: "porcentaje"; porcentajeBp: number } | { tipo: "monto_fijo"; montoCentavos: bigint };

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function exigirWopa(sesion: SesionActiva, roles: Parameters<typeof esWopa>[1] = ["wopa_admin", "wopa_operaciones"]): void {
  if (!esWopa(sesion, roles)) throw new ErrorNegocio("SIN_PERMISO", "Esta acción es solo para el equipo de WOPA.", { estado: 403 });
}

/** WOPA o personal del hotel dueño de la organización. */
async function exigirAccesoHotel(sesion: SesionActiva, hotelId: string, conexion: Consulta, rolesHotel: Parameters<typeof hotelesDe>[1] = ["hotel_admin"]): Promise<void> {
  if (esWopa(sesion, ["wopa_admin", "wopa_operaciones"])) return;
  const { rows } = await conexion.query<{ organizacion_id: string }>("SELECT organizacion_id FROM catalogo.hoteles WHERE id = $1", [hotelId]);
  if (!rows[0] || !hotelesDe(sesion, rolesHotel).includes(rows[0].organizacion_id)) {
    throw new ErrorNegocio("SIN_PERMISO", "No tienes acceso a este hotel.", { estado: 403 });
  }
}

function validarRegla(regla: ReglaMargenEntrada): void {
  if (regla.tipo === "porcentaje" && (!Number.isInteger(regla.porcentajeBp) || regla.porcentajeBp < 0 || regla.porcentajeBp > 10_000)) {
    throw new ErrorNegocio("MARGEN_INVALIDO", "El margen debe estar entre 0 % y 100 %.", { campo: "margen" });
  }
  if (regla.tipo === "monto_fijo" && regla.montoCentavos < 0n) {
    throw new ErrorNegocio("MARGEN_INVALIDO", "El margen fijo no puede ser negativo.", { campo: "margen" });
  }
}

function validarRango(desde: string, hasta: string): void {
  if (!FECHA.test(desde) || !FECHA.test(hasta) || hasta < desde) throw new ErrorNegocio("RANGO_INVALIDO", "El rango de fechas no es válido.", { campo: "hasta" });
  const dias = (Date.parse(hasta) - Date.parse(desde)) / 86_400_000;
  if (dias > 730) throw new ErrorNegocio("RANGO_INVALIDO", "El rango no puede superar dos años.", { campo: "hasta" });
}

// ---------------------------------------------------------------- hoteles

export interface NuevoHotel {
  nombre: string;
  ciudadId: string;
  zonaId?: string | null;
  monedaCodigo: string;
  direccion: string;
  latitud: number;
  longitud: number;
  categoria?: number | null;
  correoReservas?: string | null;
  telefono?: string | null;
  registroTurismo?: string | null;
  modoReserva?: "anticipo_en_linea" | "solicitud";
}

/** Crea la organización del hotel, el hotel en borrador, una política y un plan base. */
export async function crearHotel(sesion: SesionActiva, datos: NuevoHotel, cliente?: Consulta): Promise<{ hotelId: string; organizacionId: string; slug: string }> {
  exigirWopa(sesion);
  const nombre = datos.nombre.trim();
  if (nombre.length < 2) throw new ErrorNegocio("NOMBRE_INVALIDO", "Escribe el nombre del hotel.", { campo: "nombre" });

  return enTransaccion(async (tx) => {
    const ciudad = (await tx.query<{ zona_horaria: string }>("SELECT zona_horaria FROM geo.ciudades WHERE id = $1", [datos.ciudadId])).rows[0];
    if (!ciudad) throw new ErrorNegocio("CIUDAD_INVALIDA", "La ciudad no existe.", { campo: "ciudadId" });

    let slug = crearSlug(nombre);
    const repetidos = (await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM catalogo.hoteles WHERE slug = $1 OR slug LIKE $1 || '-%'", [slug])).rows[0].n;
    if (repetidos > 0) slug = `${slug}-${repetidos + 1}`;

    const organizacionId = (await tx.query<{ id: string }>("INSERT INTO identidad.organizaciones (nombre, tipo) VALUES ($1, 'hotel') RETURNING id", [nombre])).rows[0].id;
    const hotelId = (await tx.query<{ id: string }>(
      `INSERT INTO catalogo.hoteles (organizacion_id, ciudad_id, zona_id, slug, nombre, categoria, modo_reserva, moneda_codigo, zona_horaria,
         latitud, longitud, direccion, registro_turismo, correo_reservas, telefono)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
      [
        organizacionId, datos.ciudadId, datos.zonaId ?? null, slug, nombre, datos.categoria ?? null, datos.modoReserva ?? "anticipo_en_linea",
        datos.monedaCodigo, ciudad.zona_horaria, datos.latitud, datos.longitud, datos.direccion.trim(), datos.registroTurismo ?? null,
        datos.correoReservas ?? null, datos.telefono ?? null,
      ],
    )).rows[0].id;

    const politica = (await tx.query<{ id: string }>("INSERT INTO tarifas.politicas_cancelacion (hotel_id, codigo) VALUES ($1, 'flexible') RETURNING id", [hotelId])).rows[0].id;
    // Por defecto: gratis hasta 3 días antes; después se retiene el anticipo (25 %).
    await tx.query("INSERT INTO tarifas.politica_reglas (politica_id, dias_antes_llegada, penalizacion_bp) VALUES ($1, 3, 0), ($1, 0, 2500)", [politica]);
    const plan = (await tx.query<{ id: string }>("INSERT INTO tarifas.planes_tarifa (hotel_id, politica_cancelacion_id, codigo) VALUES ($1, $2, 'base') RETURNING id", [hotelId, politica])).rows[0].id;
    await tx.query("INSERT INTO tarifas.plan_tarifa_traducciones (plan_tarifa_id, idioma_codigo, nombre) VALUES ($1, 'es', 'Tarifa base'), ($1, 'en', 'Standard rate')", [plan]);

    await registrarEvento({ entidad: "hotel", entidadId: hotelId, accion: "creado", actor: { tipo: "usuario", usuarioId: sesion.usuario.id }, despues: { nombre, slug } }, tx);
    return { hotelId, organizacionId, slug };
  }, cliente);
}

/** El hotel envía su ficha a revisión de WOPA. */
export async function enviarARevision(sesion: SesionActiva, hotelId: string, cliente?: Consulta): Promise<void> {
  const conexion = db(cliente);
  await exigirAccesoHotel(sesion, hotelId, conexion);
  const { rowCount } = await conexion.query("UPDATE catalogo.hoteles SET estado = 'en_revision' WHERE id = $1 AND estado = 'borrador'", [hotelId]);
  if (!rowCount) throw new ErrorNegocio("ESTADO_INVALIDO", "Solo un hotel en borrador puede enviarse a revisión.", { estado: 409 });
}

/** WOPA acepta el hotel, configura su margen y lo publica en una sola operación. */
export async function aceptarHotel(
  sesion: SesionActiva,
  datos: { hotelId: string; margen: ReglaMargenEntrada; motivo?: string; desde?: string },
  cliente?: Consulta,
): Promise<void> {
  exigirWopa(sesion);
  validarRegla(datos.margen);
  await enTransaccion(async (tx) => {
    const hotel = (await tx.query<{ estado: string }>("SELECT estado FROM catalogo.hoteles WHERE id = $1 FOR UPDATE", [datos.hotelId])).rows[0];
    if (!hotel) throw new ErrorNegocio("HOTEL_NO_ENCONTRADO", "El hotel no existe.", { estado: 404 });
    if (!["borrador", "en_revision"].includes(hotel.estado)) throw new ErrorNegocio("ESTADO_INVALIDO", "El hotel ya fue aceptado.", { estado: 409 });

    await tx.query("UPDATE catalogo.hoteles SET aceptado_por = $2, aceptado_en = now() WHERE id = $1", [datos.hotelId, sesion.usuario.id]);
    await insertarRegla(tx, sesion, {
      hotelId: datos.hotelId,
      planTarifaId: null,
      regla: datos.margen,
      desde: datos.desde ?? new Date().toISOString().slice(0, 10),
      hasta: null,
      motivo: datos.motivo?.trim() || "Margen acordado al aceptar el hotel",
    });
    await tx.query("UPDATE catalogo.hoteles SET estado = 'publicado' WHERE id = $1", [datos.hotelId]);
    await registrarEvento({ entidad: "hotel", entidadId: datos.hotelId, accion: "aceptado", actor: { tipo: "usuario", usuarioId: sesion.usuario.id }, despues: { margen: serializarRegla(datos.margen) } }, tx);
  }, cliente);
}

function serializarRegla(regla: ReglaMargenEntrada) {
  return regla.tipo === "porcentaje" ? { tipo: regla.tipo, porcentajeBp: regla.porcentajeBp } : { tipo: regla.tipo, montoCentavos: regla.montoCentavos.toString() };
}

async function insertarRegla(
  tx: Consulta,
  sesion: SesionActiva,
  datos: { hotelId: string; planTarifaId: string | null; regla: ReglaMargenEntrada; desde: string; hasta: string | null; motivo: string },
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO tarifas.reglas_margen (hotel_id, plan_tarifa_id, tipo, porcentaje_bp, monto_centavos, vigente_desde, vigente_hasta, motivo, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      datos.hotelId, datos.planTarifaId, datos.regla.tipo,
      datos.regla.tipo === "porcentaje" ? datos.regla.porcentajeBp : null,
      datos.regla.tipo === "monto_fijo" ? datos.regla.montoCentavos.toString() : null,
      datos.desde, datos.hasta, datos.motivo, sesion.usuario.id,
    ],
  );
  return rows[0].id;
}

/**
 * WOPA ajusta un margen desde una fecha. La regla vigente del mismo alcance se cierra el día anterior;
 * las reservas ya hechas no cambian (tienen el precio congelado).
 */
export async function ajustarMargen(
  sesion: SesionActiva,
  datos: { hotelId: string; planTarifaId?: string | null; regla: ReglaMargenEntrada; desde: string; hasta?: string | null; motivo: string },
  cliente?: Consulta,
): Promise<{ reglaId: string }> {
  exigirWopa(sesion);
  validarRegla(datos.regla);
  if (!FECHA.test(datos.desde) || (datos.hasta && datos.hasta < datos.desde)) throw new ErrorNegocio("RANGO_INVALIDO", "Las fechas del ajuste no son válidas.", { campo: "desde" });
  if (datos.motivo.trim().length < 3) throw new ErrorNegocio("MOTIVO_OBLIGATORIO", "Escribe el motivo del ajuste.", { campo: "motivo" });
  const plan = datos.planTarifaId ?? null;

  return enTransaccion(async (tx) => {
    const solapadas = (await tx.query<{ id: string; vigente_desde: string; vigente_hasta: string | null; tipo: string; porcentaje_bp: number | null; monto_centavos: string | null }>(
      `SELECT id, vigente_desde::text, vigente_hasta::text, tipo, porcentaje_bp, monto_centavos
       FROM tarifas.reglas_margen
       WHERE hotel_id = $1 AND plan_tarifa_id IS NOT DISTINCT FROM $2
         AND daterange(vigente_desde, vigente_hasta, '[]') && daterange($3::date, $4::date, '[]')
       FOR UPDATE`,
      [datos.hotelId, plan, datos.desde, datos.hasta ?? null],
    )).rows;

    for (const regla of solapadas) {
      if (regla.vigente_desde >= datos.desde) {
        throw new ErrorNegocio("AJUSTE_SOLAPADO", `Ya hay un margen programado desde el ${regla.vigente_desde}. Ajusta a partir de esa fecha o elige otras fechas.`, { estado: 409, campo: "desde" });
      }
      if (datos.hasta && (regla.vigente_hasta === null || regla.vigente_hasta > datos.hasta)) {
        throw new ErrorNegocio("AJUSTE_PARCIAL", "Para un ajuste temporal, usa una regla por plan o cierra la vigente; los ajustes con fecha de fin dentro de otra regla aún no se dividen automáticamente.", { estado: 409 });
      }
      await tx.query("UPDATE tarifas.reglas_margen SET vigente_hasta = $2::date - 1 WHERE id = $1", [regla.id, datos.desde]);
    }

    const reglaId = await insertarRegla(tx, sesion, { hotelId: datos.hotelId, planTarifaId: plan, regla: datos.regla, desde: datos.desde, hasta: datos.hasta ?? null, motivo: datos.motivo.trim() });
    await registrarEvento(
      {
        entidad: "regla_margen", entidadId: reglaId, accion: "margen_ajustado", actor: { tipo: "usuario", usuarioId: sesion.usuario.id },
        antes: solapadas, despues: { ...serializarRegla(datos.regla), desde: datos.desde, hasta: datos.hasta ?? null, plan, motivo: datos.motivo },
      },
      tx,
    );
    return { reglaId };
  }, cliente);
}

// ---------------------------------------------------------------- habitaciones y planes

export async function crearTipoHabitacion(
  sesion: SesionActiva,
  datos: { hotelId: string; codigo: string; capacidadMaxima: number; nombre: { es: string; en?: string }; descripcion?: { es?: string; en?: string } },
  cliente?: Consulta,
): Promise<string> {
  return enTransaccion(async (tx) => {
    await exigirAccesoHotel(sesion, datos.hotelId, tx);
    const codigo = crearSlug(datos.codigo).slice(0, 40);
    if (codigo.length < 2) throw new ErrorNegocio("CODIGO_INVALIDO", "El código de la habitación no es válido.", { campo: "codigo" });
    const id = (await tx.query<{ id: string }>(
      "INSERT INTO catalogo.tipos_habitacion (hotel_id, codigo, capacidad_maxima) VALUES ($1, $2, $3) RETURNING id",
      [datos.hotelId, codigo, datos.capacidadMaxima],
    )).rows[0].id;
    for (const idioma of ["es", "en"] as const) {
      const nombre = datos.nombre[idioma];
      if (nombre) {
        await tx.query(
          "INSERT INTO catalogo.tipo_habitacion_traducciones (tipo_habitacion_id, idioma_codigo, nombre, descripcion) VALUES ($1, $2, $3, $4)",
          [id, idioma, nombre, datos.descripcion?.[idioma] ?? null],
        );
      }
    }
    return id;
  }, cliente);
}

// ---------------------------------------------------------------- tarifa neta y cupos

/**
 * Carga la tarifa neta por rango (el hotel la ve; el público ve neta + margen).
 * Si cambia más de 40 % frente al promedio de los 30 días previos, crea una alerta para WOPA.
 */
export async function cargarTarifaNeta(
  sesion: SesionActiva,
  datos: { hotelId: string; planTarifaId: string; tipoHabitacionId: string; desde: string; hasta: string; ocupacion: number; netoCentavos: bigint; estanciaMinima?: number },
  cliente?: Consulta,
): Promise<{ dias: number }> {
  validarRango(datos.desde, datos.hasta);
  if (datos.netoCentavos <= 0n) throw new ErrorNegocio("PRECIO_INVALIDO", "La tarifa debe ser mayor que cero.", { campo: "neto" });
  return enTransaccion(async (tx) => {
    await exigirAccesoHotel(sesion, datos.hotelId, tx);
    const promedio = (await tx.query<{ promedio: string | null }>(
      `SELECT avg(monto_neto_centavos)::bigint AS promedio FROM tarifas.precios_dia
       WHERE tipo_habitacion_id = $1 AND plan_tarifa_id = $2 AND ocupacion = $3 AND fecha BETWEEN $4::date - 30 AND $4::date - 1`,
      [datos.tipoHabitacionId, datos.planTarifaId, datos.ocupacion, datos.desde],
    )).rows[0].promedio;

    const { rowCount } = await tx.query(
      `INSERT INTO tarifas.precios_dia (hotel_id, plan_tarifa_id, tipo_habitacion_id, fecha, ocupacion, monto_neto_centavos, estancia_minima)
       SELECT $1, $2, $3, d::date, $4, $5, $6 FROM generate_series($7::date, $8::date, '1 day') d
       ON CONFLICT (plan_tarifa_id, tipo_habitacion_id, fecha, ocupacion)
       DO UPDATE SET monto_neto_centavos = EXCLUDED.monto_neto_centavos, estancia_minima = EXCLUDED.estancia_minima`,
      [datos.hotelId, datos.planTarifaId, datos.tipoHabitacionId, datos.ocupacion, datos.netoCentavos.toString(), datos.estanciaMinima ?? 1, datos.desde, datos.hasta],
    );

    if (promedio) {
      const variacion = Math.abs(Number(datos.netoCentavos) - Number(promedio)) / Number(promedio);
      if (variacion > 0.4) {
        await crearAlerta(
          {
            tipo: "precio_anomalo", severidad: "advertencia", hotelId: datos.hotelId, entidad: "tipo_habitacion", entidadId: datos.tipoHabitacionId,
            detalle: { promedioCentavos: promedio, nuevoCentavos: datos.netoCentavos.toString(), variacionPct: Math.round(variacion * 100), desde: datos.desde },
          },
          tx,
        );
      }
    }
    await registrarEvento(
      { entidad: "tarifa", entidadId: datos.tipoHabitacionId, accion: "tarifa_neta_cargada", actor: { tipo: "usuario", usuarioId: sesion.usuario.id }, despues: { ...datos, netoCentavos: datos.netoCentavos.toString() } },
      tx,
    );
    return { dias: rowCount ?? 0 };
  }, cliente);
}

/** Fija el cupo total por día o cierra la venta. No baja el cupo por debajo de lo ya vendido. */
export async function cargarCupos(
  sesion: SesionActiva,
  datos: { hotelId: string; tipoHabitacionId: string; desde: string; hasta: string; cupoTotal?: number; cerrado?: boolean },
  cliente?: Consulta,
): Promise<{ dias: number }> {
  validarRango(datos.desde, datos.hasta);
  return enTransaccion(async (tx) => {
    await exigirAccesoHotel(sesion, datos.hotelId, tx, ["hotel_admin", "hotel_recepcion"]);
    const pertenece = (await tx.query("SELECT 1 FROM catalogo.tipos_habitacion WHERE id = $1 AND hotel_id = $2", [datos.tipoHabitacionId, datos.hotelId])).rows[0];
    if (!pertenece) throw new ErrorNegocio("HABITACION_INVALIDA", "La habitación no es de este hotel.", { estado: 404 });

    const conflicto = datos.cupoTotal === undefined ? undefined : (await tx.query<{ fecha: string; vendido: number }>(
      `SELECT fecha::text, cupo_vendido AS vendido FROM tarifas.cupos_dia
       WHERE tipo_habitacion_id = $1 AND fecha BETWEEN $2 AND $3 AND cupo_vendido > $4 ORDER BY fecha LIMIT 1`,
      [datos.tipoHabitacionId, datos.desde, datos.hasta, datos.cupoTotal],
    )).rows[0];
    if (conflicto) {
      throw new ErrorNegocio("CUPO_MENOR_A_VENDIDO", `El ${conflicto.fecha} ya hay ${conflicto.vendido} habitaciones vendidas; el cupo no puede ser menor.`, { estado: 409, campo: "cupoTotal" });
    }
    const { rowCount } = await tx.query(
      `INSERT INTO tarifas.cupos_dia (tipo_habitacion_id, fecha, cupo_total, esta_cerrado)
       SELECT $1, d::date, coalesce($4, 0), coalesce($5, false) FROM generate_series($2::date, $3::date, '1 day') d
       ON CONFLICT (tipo_habitacion_id, fecha) DO UPDATE SET
         cupo_total = coalesce($4, tarifas.cupos_dia.cupo_total),
         esta_cerrado = coalesce($5, tarifas.cupos_dia.esta_cerrado)`,
      [datos.tipoHabitacionId, datos.desde, datos.hasta, datos.cupoTotal ?? null, datos.cerrado ?? null],
    );
    return { dias: rowCount ?? 0 };
  }, cliente);
}

// ---------------------------------------------------------------- consultas del panel

export async function listarHotelesAdmin(sesion: SesionActiva, cliente?: Consulta) {
  exigirWopa(sesion, ["wopa_admin", "wopa_operaciones", "wopa_soporte", "wopa_finanzas"]);
  const { rows } = await db(cliente).query<{
    id: string; slug: string; nombre: string; estado: string; modo_reserva: string; ciudad: string; pais: string;
    margen_tipo: string | null; margen_porcentaje_bp: number | null; margen_monto_centavos: string | null; alertas_abiertas: number;
  }>(
    `SELECT h.id, h.slug, h.nombre, h.estado, h.modo_reserva, ct.nombre AS ciudad, c.pais_codigo AS pais,
       r.tipo AS margen_tipo, r.porcentaje_bp AS margen_porcentaje_bp, r.monto_centavos AS margen_monto_centavos,
       (SELECT count(*)::int FROM auditoria.alertas a WHERE a.hotel_id = h.id AND a.estado = 'abierta') AS alertas_abiertas
     FROM catalogo.hoteles h
     JOIN geo.ciudades c ON c.id = h.ciudad_id
     JOIN geo.ciudad_traducciones ct ON ct.ciudad_id = c.id AND ct.idioma_codigo = 'es'
     LEFT JOIN LATERAL (
       SELECT tipo, porcentaje_bp, monto_centavos FROM tarifas.reglas_margen
       WHERE hotel_id = h.id AND plan_tarifa_id IS NULL AND vigente_desde <= current_date AND (vigente_hasta IS NULL OR vigente_hasta >= current_date)
       LIMIT 1
     ) r ON true
     WHERE h.eliminado_en IS NULL
     ORDER BY CASE h.estado WHEN 'en_revision' THEN 0 WHEN 'borrador' THEN 1 ELSE 2 END, h.nombre`,
  );
  return rows;
}

export async function historialMargenes(sesion: SesionActiva, hotelId: string, cliente?: Consulta) {
  exigirWopa(sesion, ["wopa_admin", "wopa_operaciones", "wopa_finanzas"]);
  const { rows } = await db(cliente).query(
    `SELECT r.id, r.plan_tarifa_id, r.tipo, r.porcentaje_bp, r.monto_centavos, r.vigente_desde::text, r.vigente_hasta::text, r.motivo,
            u.nombre AS creado_por, r.creado_en
     FROM tarifas.reglas_margen r JOIN identidad.usuarios u ON u.id = r.creado_por
     WHERE r.hotel_id = $1 ORDER BY r.vigente_desde DESC, r.creado_en DESC`,
    [hotelId],
  );
  return rows;
}

export async function listarCiudades(idioma: "es" | "en" = "es", cliente?: Consulta) {
  const { rows } = await db(cliente).query<{ id: string; nombre: string; pais: string; moneda: string }>(
    `SELECT c.id, t.nombre, c.pais_codigo AS pais, p.moneda_codigo AS moneda
     FROM geo.ciudades c JOIN geo.ciudad_traducciones t ON t.ciudad_id = c.id AND t.idioma_codigo = $1
     JOIN geo.paises p ON p.codigo = c.pais_codigo
     WHERE c.esta_activa ORDER BY c.pais_codigo DESC, t.nombre`,
    [idioma],
  );
  return rows;
}

export async function detalleHotelAdmin(sesion: SesionActiva, hotelId: string, cliente?: Consulta) {
  const conexion = db(cliente);
  await exigirAccesoHotel(sesion, hotelId, conexion, ["hotel_admin", "hotel_recepcion"]);
  const hotel = (await conexion.query<{
    id: string; slug: string; nombre: string; estado: string; modo_reserva: string; moneda: string; direccion: string;
    organizacion_id: string; ciudad: string; aceptado_en: Date | null; registro_turismo: string | null; correo_reservas: string | null; telefono: string | null;
  }>(
    `SELECT h.id, h.slug, h.nombre, h.estado, h.modo_reserva, h.moneda_codigo AS moneda, h.direccion, h.organizacion_id, ct.nombre AS ciudad,
       h.aceptado_en, h.registro_turismo, h.correo_reservas, h.telefono
     FROM catalogo.hoteles h JOIN geo.ciudad_traducciones ct ON ct.ciudad_id = h.ciudad_id AND ct.idioma_codigo = 'es'
     WHERE h.id = $1`,
    [hotelId],
  )).rows[0];
  if (!hotel) return null;
  const habitaciones = (await conexion.query<{ id: string; codigo: string; nombre: string; capacidad_maxima: number; esta_activo: boolean }>(
    `SELECT t.id, t.codigo, coalesce(tt.nombre, t.codigo) AS nombre, t.capacidad_maxima, t.esta_activo
     FROM catalogo.tipos_habitacion t LEFT JOIN catalogo.tipo_habitacion_traducciones tt ON tt.tipo_habitacion_id = t.id AND tt.idioma_codigo = 'es'
     WHERE t.hotel_id = $1 ORDER BY t.creado_en`,
    [hotelId],
  )).rows;
  const planes = (await conexion.query<{ id: string; codigo: string; nombre: string; anticipo_bp: number }>(
    `SELECT p.id, p.codigo, coalesce(pt.nombre, p.codigo) AS nombre, p.anticipo_bp
     FROM tarifas.planes_tarifa p LEFT JOIN tarifas.plan_tarifa_traducciones pt ON pt.plan_tarifa_id = p.id AND pt.idioma_codigo = 'es'
     WHERE p.hotel_id = $1 AND p.esta_activo ORDER BY p.creado_en`,
    [hotelId],
  )).rows;
  const equipo = (await conexion.query<{ nombre: string; correo: string; rol: string }>(
    `SELECT u.nombre, u.correo, m.rol FROM identidad.membresias m JOIN identidad.usuarios u ON u.id = m.usuario_id
     WHERE m.organizacion_id = $1 ORDER BY u.nombre`,
    [hotel.organizacion_id],
  )).rows;
  const invitaciones = (await conexion.query<{ correo: string; rol: string; expira_en: Date }>(
    "SELECT correo, rol, expira_en FROM identidad.invitaciones WHERE organizacion_id = $1 AND aceptada_en IS NULL AND expira_en > now() ORDER BY creado_en DESC",
    [hotel.organizacion_id],
  )).rows;
  const proximosPrecios = (await conexion.query<{ habitacion: string; plan: string; ocupacion: number; desde: string; hasta: string; neto: string; dias: number }>(
    `SELECT coalesce(tt.nombre, t.codigo) AS habitacion, p.codigo AS plan, pd.ocupacion, min(pd.fecha)::text AS desde, max(pd.fecha)::text AS hasta,
       pd.monto_neto_centavos AS neto, count(*)::int AS dias
     FROM tarifas.precios_dia pd
     JOIN catalogo.tipos_habitacion t ON t.id = pd.tipo_habitacion_id
     LEFT JOIN catalogo.tipo_habitacion_traducciones tt ON tt.tipo_habitacion_id = t.id AND tt.idioma_codigo = 'es'
     JOIN tarifas.planes_tarifa p ON p.id = pd.plan_tarifa_id
     WHERE pd.hotel_id = $1 AND pd.fecha >= current_date
     GROUP BY tt.nombre, t.codigo, p.codigo, pd.ocupacion, pd.monto_neto_centavos
     ORDER BY habitacion, plan, ocupacion, desde LIMIT 50`,
    [hotelId],
  )).rows;
  return { ...hotel, habitaciones, planes, equipo, invitaciones, proximosPrecios };
}

export async function alertasAbiertas(sesion: SesionActiva, cliente?: Consulta) {
  exigirWopa(sesion, ["wopa_admin", "wopa_operaciones", "wopa_soporte", "wopa_finanzas"]);
  const { rows } = await db(cliente).query<{ id: string; tipo: string; severidad: string; hotel: string | null; hotel_id: string | null; detalle: Record<string, unknown>; creado_en: Date }>(
    `SELECT a.id, a.tipo, a.severidad, h.nombre AS hotel, a.hotel_id, a.detalle, a.creado_en
     FROM auditoria.alertas a LEFT JOIN catalogo.hoteles h ON h.id = a.hotel_id
     WHERE a.estado = 'abierta' ORDER BY CASE a.severidad WHEN 'critica' THEN 0 WHEN 'advertencia' THEN 1 ELSE 2 END, a.creado_en DESC LIMIT 100`,
  );
  return rows;
}

export async function atenderAlerta(sesion: SesionActiva, alertaId: string, descartar: boolean, cliente?: Consulta): Promise<void> {
  exigirWopa(sesion, ["wopa_admin", "wopa_operaciones", "wopa_soporte", "wopa_finanzas"]);
  await db(cliente).query(
    "UPDATE auditoria.alertas SET estado = $2, atendida_por = $3, atendida_en = now() WHERE id = $1 AND estado = 'abierta'",
    [alertaId, descartar ? "descartada" : "atendida", sesion.usuario.id],
  );
}
