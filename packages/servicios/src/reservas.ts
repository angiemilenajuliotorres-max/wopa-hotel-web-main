/**
 * Reservas: creación con precio congelado, retención de cupo sin sobreventa, expiración,
 * solicitudes que el hotel acepta o rechaza, consulta y cancelación por el huésped.
 * Ciclo de vida: docs/arquitectura/02-software.md.
 */
import { calcularCancelacion, describirPolitica, diasEntre, generarCodigoReserva } from "@wopa/dominio/reservas";
import { registrarEvento } from "./auditoria.ts";
import { type Idioma, noches, opcionesDeHoteles, validarCriterios } from "./busqueda.ts";
import { db, enTransaccion, ErrorNegocio, type Consulta } from "./conexion.ts";
import { esWopa, hotelesDe, type SesionActiva } from "./identidad.ts";
import { encolarCorreo } from "./notificaciones.ts";

export const MINUTOS_RETENCION = 15;
export const HORAS_PARA_PAGAR_SOLICITUD = 48;

export interface Titular {
  nombre: string;
  correo: string;
  telefono: string;
  paisCodigo?: string | null;
}

export interface NuevaReserva {
  hotelSlug: string;
  tipoHabitacionId: string;
  planTarifaId: string;
  entrada: string;
  salida: string;
  huespedes: number;
  titular: Titular;
  solicitudesEspeciales?: string | null;
  idioma: Idioma;
}

function validarTitular(titular: Titular): void {
  if (titular.nombre.trim().length < 2) throw new ErrorNegocio("NOMBRE_INVALIDO", "Escribe el nombre del titular.", { campo: "nombre" });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(titular.correo.trim())) throw new ErrorNegocio("CORREO_INVALIDO", "El correo no es válido.", { campo: "correo" });
  const telefono = titular.telefono.replace(/[^\d+]/g, "");
  if (telefono.length < 7 || telefono.length > 20) throw new ErrorNegocio("TELEFONO_INVALIDO", "Escribe un teléfono con código de país.", { campo: "telefono" });
}

export function formatoDinero(centavos: bigint, moneda: string, idioma: Idioma): string {
  return new Intl.NumberFormat(idioma === "es" ? "es-PA" : "en-US", { style: "currency", currency: moneda }).format(Number(centavos) / 100);
}

async function liberarCupos(tx: Consulta, reservaId: string): Promise<void> {
  await tx.query(
    `UPDATE tarifas.cupos_dia c SET cupo_vendido = c.cupo_vendido - l.cantidad
     FROM reservas.reserva_lineas l, reservas.reserva_noches n
     WHERE l.reserva_id = $1 AND n.reserva_linea_id = l.id AND c.tipo_habitacion_id = l.tipo_habitacion_id AND c.fecha = n.fecha`,
    [reservaId],
  );
}

/**
 * Crea la reserva. En hoteles con anticipo en línea retiene el cupo 15 minutos mientras se paga;
 * en hoteles bajo solicitud queda 'solicitada' hasta que el hotel o WOPA la acepte.
 */
export async function crearReserva(
  datos: NuevaReserva,
  cliente?: Consulta,
): Promise<{ codigo: string; estado: "retenida" | "solicitada"; totalCentavos: bigint; anticipoCentavos: bigint; saldoCentavos: bigint; moneda: string; retenidaHasta: Date | null }> {
  const criterios = { entrada: datos.entrada, salida: datos.salida, huespedes: datos.huespedes, idioma: datos.idioma };
  validarCriterios(criterios);
  validarTitular(datos.titular);

  return enTransaccion(async (tx) => {
    const hotel = (await tx.query<{ id: string; nombre: string; moneda: string; modo: "anticipo_en_linea" | "solicitud" }>(
      "SELECT id, nombre, moneda_codigo AS moneda, modo_reserva AS modo FROM catalogo.hoteles WHERE slug = $1 AND estado = 'publicado' AND eliminado_en IS NULL",
      [datos.hotelSlug],
    )).rows[0];
    if (!hotel) throw new ErrorNegocio("HOTEL_NO_DISPONIBLE", "Este hotel ya no está disponible.", { estado: 404 });

    const opcion = (await opcionesDeHoteles(tx, [hotel.id], criterios)).get(hotel.id)
      ?.find((o) => o.tipoHabitacionId === datos.tipoHabitacionId && o.planTarifaId === datos.planTarifaId);
    if (!opcion) throw new ErrorNegocio("OPCION_NO_DISPONIBLE", "Esa habitación ya no tiene precio para estas fechas. Elige otra opción.", { estado: 409 });

    const listaNoches = noches(datos.entrada, datos.salida);
    const estado = hotel.modo === "anticipo_en_linea" ? "retenida" : "solicitada";
    if (estado === "retenida") {
      // Descuento condicional: si alguna noche no tiene cupo, se actualizan menos filas y se cancela todo.
      const { rowCount } = await tx.query(
        `UPDATE tarifas.cupos_dia SET cupo_vendido = cupo_vendido + 1
         WHERE tipo_habitacion_id = $1 AND fecha >= $2 AND fecha < $3 AND NOT esta_cerrado AND cupo_total - cupo_vendido >= 1`,
        [datos.tipoHabitacionId, datos.entrada, datos.salida],
      );
      if (rowCount !== listaNoches.length) throw new ErrorNegocio("SIN_CUPO", "Se acaba de agotar esta habitación para tus fechas.", { estado: 409 });
    }

    let codigo = generarCodigoReserva();
    while ((await tx.query("SELECT 1 FROM reservas.reservas WHERE codigo = $1", [codigo])).rows[0]) codigo = generarCodigoReserva();

    const { estadia } = { estadia: opcion.interno };
    const reserva = (await tx.query<{ id: string; retenida_hasta: Date | null }>(
      `INSERT INTO reservas.reservas (codigo, hotel_id, estado, fecha_entrada, fecha_salida, idioma_codigo, moneda_codigo,
         total_venta_centavos, anticipo_centavos, titular_nombre, titular_correo, titular_telefono, titular_pais_codigo,
         solicitudes_especiales, politica_cancelacion, retenida_hasta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
         CASE WHEN $3 = 'retenida' THEN now() + make_interval(mins => $16) END)
       RETURNING id, retenida_hasta`,
      [
        codigo, hotel.id, estado, datos.entrada, datos.salida, datos.idioma, hotel.moneda,
        estadia.totalVentaCentavos.toString(), estadia.anticipoCentavos.toString(),
        datos.titular.nombre.trim(), datos.titular.correo.trim().toLowerCase(), datos.titular.telefono.trim(), datos.titular.paisCodigo ?? null,
        datos.solicitudesEspeciales?.trim().slice(0, 2000) || null,
        JSON.stringify({ reglas: opcion.politica, descripcion: describirPolitica(opcion.politica, datos.entrada, datos.idioma) }),
        MINUTOS_RETENCION,
      ],
    )).rows[0];
    const linea = (await tx.query<{ id: string }>(
      "INSERT INTO reservas.reserva_lineas (reserva_id, hotel_id, tipo_habitacion_id, plan_tarifa_id, adultos) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [reserva.id, hotel.id, datos.tipoHabitacionId, datos.planTarifaId, datos.huespedes],
    )).rows[0].id;
    for (const noche of estadia.noches) {
      await tx.query(
        "INSERT INTO reservas.reserva_noches (reserva_linea_id, fecha, monto_neto_centavos, margen_centavos, regla_margen_id) VALUES ($1, $2, $3, $4, $5)",
        [linea, noche.fecha, noche.netoCentavos.toString(), noche.margenCentavos.toString(), noche.reglaMargenId],
      );
    }

    if (estado === "solicitada") {
      const es = datos.idioma === "es";
      await encolarCorreo(
        {
          para: datos.titular.correo,
          plantilla: "reserva_solicitada",
          idioma: datos.idioma,
          asunto: es ? `Recibimos tu solicitud ${codigo} · ${hotel.nombre}` : `We received your request ${codigo} · ${hotel.nombre}`,
          texto: es
            ? `Hola ${datos.titular.nombre}:\n\nRecibimos tu solicitud en ${hotel.nombre} del ${datos.entrada} al ${datos.salida}.\nEl hotel confirmará la disponibilidad y te enviaremos un enlace para pagar el anticipo de ${formatoDinero(estadia.anticipoCentavos, hotel.moneda, "es")}. Todavía no se ha hecho ningún cobro.\n\nCódigo: ${codigo}`
            : `Hi ${datos.titular.nombre},\n\nWe received your request at ${hotel.nombre} from ${datos.entrada} to ${datos.salida}.\nThe hotel will confirm availability and we'll send you a link to pay the ${formatoDinero(estadia.anticipoCentavos, hotel.moneda, "en")} deposit. You have not been charged yet.\n\nCode: ${codigo}`,
        },
        tx,
      );
    }
    await registrarEvento({ entidad: "reserva", entidadId: reserva.id, accion: "creada", actor: { tipo: "sistema" }, despues: { codigo, estado } }, tx);
    return {
      codigo, estado, moneda: hotel.moneda, retenidaHasta: reserva.retenida_hasta ? new Date(reserva.retenida_hasta) : null,
      totalCentavos: estadia.totalVentaCentavos, anticipoCentavos: estadia.anticipoCentavos, saldoCentavos: estadia.saldoCentavos,
    };
  }, cliente);
}

/** Pasa la reserva retenida a 'pendiente_pago' cuando el viajero inicia el pago. */
export async function marcarPendientePago(reservaId: string, tx: Consulta): Promise<void> {
  await tx.query("UPDATE reservas.reservas SET estado = 'pendiente_pago' WHERE id = $1 AND estado = 'retenida'", [reservaId]);
}

/** Expira retenciones y pagos no completados y devuelve sus cupos. Lo ejecuta un cron cada minuto. */
export async function expirarRetenciones(cliente?: Consulta): Promise<number> {
  return enTransaccion(async (tx) => {
    const vencidas = (await tx.query<{ id: string }>(
      `SELECT id FROM reservas.reservas WHERE estado IN ('retenida', 'pendiente_pago') AND retenida_hasta < now()
       FOR UPDATE SKIP LOCKED`,
    )).rows;
    for (const { id } of vencidas) {
      // Una reserva 'pendiente_pago' con un pago ya capturado no expira (el webhook la confirmará).
      const capturado = (await tx.query("SELECT 1 FROM pagos.pagos WHERE reserva_id = $1 AND estado IN ('autorizado', 'capturado')", [id])).rows[0];
      if (capturado) continue;
      const modo = (await tx.query<{ modo: string }>("SELECT h.modo_reserva AS modo FROM reservas.reservas r JOIN catalogo.hoteles h ON h.id = r.hotel_id WHERE r.id = $1", [id])).rows[0].modo;
      if (modo === "anticipo_en_linea") await liberarCupos(tx, id);
      await tx.query("UPDATE reservas.reservas SET estado = 'expirada', retenida_hasta = NULL WHERE id = $1", [id]);
    }
    return vencidas.length;
  }, cliente);
}

/** Confirma la reserva (lo llama pagos cuando el anticipo queda capturado). */
export async function confirmarReserva(reservaId: string, tx: Consulta): Promise<void> {
  const reserva = (await tx.query<{ codigo: string; titular_nombre: string; titular_correo: string; idioma: Idioma; hotel: string; fecha_entrada: string; fecha_salida: string; saldo: string; moneda: string }>(
    `UPDATE reservas.reservas r SET estado = 'confirmada', retenida_hasta = NULL
     FROM catalogo.hoteles h WHERE r.id = $1 AND h.id = r.hotel_id AND r.estado IN ('retenida', 'pendiente_pago')
     RETURNING r.codigo, r.titular_nombre, r.titular_correo, r.idioma_codigo AS idioma, h.nombre AS hotel,
       r.fecha_entrada::text, r.fecha_salida::text, r.saldo_centavos AS saldo, r.moneda_codigo AS moneda`,
    [reservaId],
  )).rows[0];
  if (!reserva) return;
  const es = reserva.idioma === "es";
  const saldo = formatoDinero(BigInt(reserva.saldo), reserva.moneda, reserva.idioma);
  await encolarCorreo(
    {
      para: reserva.titular_correo,
      plantilla: "reserva_confirmada",
      idioma: reserva.idioma,
      asunto: es ? `Reserva confirmada ${reserva.codigo} · ${reserva.hotel}` : `Booking confirmed ${reserva.codigo} · ${reserva.hotel}`,
      texto: es
        ? `Hola ${reserva.titular_nombre}:\n\nTu reserva en ${reserva.hotel} del ${reserva.fecha_entrada} al ${reserva.fecha_salida} está confirmada.\nPagaste el anticipo. Pagarás ${saldo} en el hotel al llegar.\n\nCódigo: ${reserva.codigo}`
        : `Hi ${reserva.titular_nombre},\n\nYour booking at ${reserva.hotel} from ${reserva.fecha_entrada} to ${reserva.fecha_salida} is confirmed.\nYour deposit is paid. You'll pay ${saldo} at the hotel on arrival.\n\nCode: ${reserva.codigo}`,
    },
    tx,
  );
}

// ---------------------------------------------------------------- solicitudes (modo solicitud)

async function exigirGestionReserva(sesion: SesionActiva, reservaId: string, tx: Consulta): Promise<void> {
  if (esWopa(sesion, ["wopa_admin", "wopa_operaciones", "wopa_soporte"])) return;
  const { rows } = await tx.query<{ organizacion_id: string }>(
    "SELECT h.organizacion_id FROM reservas.reservas r JOIN catalogo.hoteles h ON h.id = r.hotel_id WHERE r.id = $1",
    [reservaId],
  );
  if (!rows[0] || !hotelesDe(sesion).includes(rows[0].organizacion_id)) throw new ErrorNegocio("SIN_PERMISO", "No tienes acceso a esta reserva.", { estado: 403 });
}

/** El hotel o WOPA acepta una solicitud: el viajero tiene 48 h para pagar el anticipo. */
export async function aceptarSolicitud(sesion: SesionActiva, reservaId: string, urlBase: string, cliente?: Consulta): Promise<void> {
  await enTransaccion(async (tx) => {
    await exigirGestionReserva(sesion, reservaId, tx);
    const reserva = (await tx.query<{ codigo: string; titular_nombre: string; titular_correo: string; idioma: Idioma; hotel: string; anticipo: string; moneda: string }>(
      `UPDATE reservas.reservas r SET estado = 'pendiente_pago', retenida_hasta = now() + make_interval(hours => $2)
       FROM catalogo.hoteles h WHERE r.id = $1 AND h.id = r.hotel_id AND r.estado = 'solicitada'
       RETURNING r.codigo, r.titular_nombre, r.titular_correo, r.idioma_codigo AS idioma, h.nombre AS hotel, r.anticipo_centavos AS anticipo, r.moneda_codigo AS moneda`,
      [reservaId, HORAS_PARA_PAGAR_SOLICITUD],
    )).rows[0];
    if (!reserva) throw new ErrorNegocio("ESTADO_INVALIDO", "La solicitud ya no está pendiente.", { estado: 409 });
    const enlace = `${urlBase.replace(/\/$/, "")}/${reserva.idioma}/reservar/${reserva.codigo}`;
    const es = reserva.idioma === "es";
    const anticipo = formatoDinero(BigInt(reserva.anticipo), reserva.moneda, reserva.idioma);
    await encolarCorreo(
      {
        para: reserva.titular_correo,
        plantilla: "solicitud_aceptada",
        idioma: reserva.idioma,
        asunto: es ? `${reserva.hotel} confirmó tu solicitud ${reserva.codigo}` : `${reserva.hotel} confirmed your request ${reserva.codigo}`,
        texto: es
          ? `Hola ${reserva.titular_nombre}:\n\nHay disponibilidad. Paga el anticipo de ${anticipo} en las próximas 48 horas para confirmar:\n${enlace}`
          : `Hi ${reserva.titular_nombre},\n\nThe room is available. Pay the ${anticipo} deposit within 48 hours to confirm:\n${enlace}`,
      },
      tx,
    );
    await registrarEvento({ entidad: "reserva", entidadId: reservaId, accion: "solicitud_aceptada", actor: { tipo: "usuario", usuarioId: sesion.usuario.id } }, tx);
  }, cliente);
}

export async function rechazarSolicitud(sesion: SesionActiva, reservaId: string, motivo: string, cliente?: Consulta): Promise<void> {
  await enTransaccion(async (tx) => {
    await exigirGestionReserva(sesion, reservaId, tx);
    const reserva = (await tx.query<{ codigo: string; titular_nombre: string; titular_correo: string; idioma: Idioma; hotel: string }>(
      `UPDATE reservas.reservas r SET estado = 'rechazada' FROM catalogo.hoteles h
       WHERE r.id = $1 AND h.id = r.hotel_id AND r.estado = 'solicitada'
       RETURNING r.codigo, r.titular_nombre, r.titular_correo, r.idioma_codigo AS idioma, h.nombre AS hotel`,
      [reservaId],
    )).rows[0];
    if (!reserva) throw new ErrorNegocio("ESTADO_INVALIDO", "La solicitud ya no está pendiente.", { estado: 409 });
    const es = reserva.idioma === "es";
    await encolarCorreo(
      {
        para: reserva.titular_correo,
        plantilla: "solicitud_rechazada",
        idioma: reserva.idioma,
        asunto: es ? `Sin disponibilidad para ${reserva.codigo}` : `No availability for ${reserva.codigo}`,
        texto: es
          ? `Hola ${reserva.titular_nombre}:\n\n${reserva.hotel} no tiene disponibilidad para tus fechas. No se hizo ningún cobro. Escríbenos desde la web y te ayudamos a encontrar otra opción.`
          : `Hi ${reserva.titular_nombre},\n\n${reserva.hotel} has no availability for your dates. You have not been charged. Contact us on the website and we'll help you find another option.`,
      },
      tx,
    );
    await registrarEvento({ entidad: "reserva", entidadId: reservaId, accion: "solicitud_rechazada", actor: { tipo: "usuario", usuarioId: sesion.usuario.id }, detalle: motivo }, tx);
  }, cliente);
}

// ---------------------------------------------------------------- consulta y cancelación por el viajero

export async function consultarReserva(codigo: string, correo: string, cliente?: Consulta) {
  const { rows } = await db(cliente).query<{
    id: string; codigo: string; estado: string; fecha_entrada: string; fecha_salida: string; idioma: Idioma; moneda: string;
    total: string; anticipo: string; saldo: string; titular_nombre: string; hotel: string; hotel_slug: string; direccion: string;
    hora_check_in: string; hora_check_out: string; habitacion: string; adultos: number; politica: { reglas: { diasAntesLlegada: number; penalizacionBp: number }[]; descripcion: string };
    retenida_hasta: Date | null; pagado: string;
  }>(
    `SELECT r.id, r.codigo, r.estado, r.fecha_entrada::text, r.fecha_salida::text, r.idioma_codigo AS idioma, r.moneda_codigo AS moneda,
       r.total_venta_centavos AS total, r.anticipo_centavos AS anticipo, r.saldo_centavos AS saldo, r.titular_nombre,
       h.nombre AS hotel, h.slug AS hotel_slug, h.direccion, h.hora_check_in::text, h.hora_check_out::text,
       coalesce(tt.nombre, t.codigo) AS habitacion, l.adultos, r.politica_cancelacion AS politica, r.retenida_hasta,
       coalesce((SELECT sum(p.monto_centavos * p.tasa_a_moneda_reserva)::bigint FROM pagos.pagos p WHERE p.reserva_id = r.id AND p.estado = 'capturado'), 0) AS pagado
     FROM reservas.reservas r
     JOIN catalogo.hoteles h ON h.id = r.hotel_id
     JOIN reservas.reserva_lineas l ON l.reserva_id = r.id
     JOIN catalogo.tipos_habitacion t ON t.id = l.tipo_habitacion_id
     LEFT JOIN catalogo.tipo_habitacion_traducciones tt ON tt.tipo_habitacion_id = t.id AND tt.idioma_codigo = r.idioma_codigo
     WHERE r.codigo = $1 AND r.titular_correo = $2`,
    [codigo.trim().toUpperCase(), correo.trim().toLowerCase()],
  );
  return rows[0] ?? null;
}

/**
 * El viajero cancela desde "Mi reserva". Calcula la penalización según la política congelada.
 * Devuelve el reembolso que debe procesar pagos (la devolución real la hace el módulo de pagos).
 */
export async function cancelarPorViajero(
  datos: { codigo: string; correo: string; motivo?: string; hoy?: string },
  cliente?: Consulta,
): Promise<{ penalizacionCentavos: bigint; reembolsoCentavos: bigint; reservaId: string }> {
  return enTransaccion(async (tx) => {
    const reserva = await consultarReserva(datos.codigo, datos.correo, tx);
    if (!reserva) throw new ErrorNegocio("RESERVA_NO_ENCONTRADA", "No encontramos una reserva con ese código y correo.", { estado: 404 });
    if (!["retenida", "pendiente_pago", "solicitada", "confirmada"].includes(reserva.estado)) {
      throw new ErrorNegocio("NO_CANCELABLE", "Esta reserva ya no se puede cancelar.", { estado: 409 });
    }
    const hoy = datos.hoy ?? new Date().toISOString().slice(0, 10);
    const { penalizacionCentavos, reembolsoCentavos } = calcularCancelacion({
      reglas: reserva.politica.reglas,
      diasAntesLlegada: diasEntre(hoy, reserva.fecha_entrada),
      totalCentavos: BigInt(reserva.total),
      pagadoCentavos: BigInt(reserva.pagado),
    });
    const modo = (await tx.query<{ modo: string }>("SELECT h.modo_reserva AS modo FROM reservas.reservas r JOIN catalogo.hoteles h ON h.id = r.hotel_id WHERE r.id = $1", [reserva.id])).rows[0].modo;
    if (modo === "anticipo_en_linea" && ["retenida", "pendiente_pago", "confirmada"].includes(reserva.estado)) await liberarCupos(tx, reserva.id);
    await tx.query("UPDATE reservas.reservas SET estado = 'cancelada', retenida_hasta = NULL WHERE id = $1", [reserva.id]);
    await registrarEvento(
      { entidad: "reserva", entidadId: reserva.id, accion: "cancelada_por_viajero", actor: { tipo: "sistema" }, detalle: datos.motivo, despues: { penalizacion: penalizacionCentavos.toString(), reembolso: reembolsoCentavos.toString() } },
      tx,
    );
    return { penalizacionCentavos, reembolsoCentavos, reservaId: reserva.id };
  }, cliente);
}

// ---------------------------------------------------------------- panel

export async function listarReservasAdmin(
  sesion: SesionActiva,
  filtro: { estado?: string; hotelOrganizaciones?: string[] } = {},
  cliente?: Consulta,
) {
  const organizaciones = esWopa(sesion, ["wopa_admin", "wopa_operaciones", "wopa_soporte", "wopa_finanzas"]) ? null : hotelesDe(sesion);
  if (organizaciones && organizaciones.length === 0) throw new ErrorNegocio("SIN_PERMISO", "No tienes acceso a reservas.", { estado: 403 });
  const { rows } = await db(cliente).query<{
    id: string; codigo: string; estado: string; hotel: string; fecha_entrada: string; fecha_salida: string; titular_nombre: string;
    titular_correo: string; titular_telefono: string; total: string; anticipo: string; moneda: string; creado_en: Date; retenida_hasta: Date | null;
  }>(
    `SELECT r.id, r.codigo, r.estado, h.nombre AS hotel, r.fecha_entrada::text, r.fecha_salida::text, r.titular_nombre, r.titular_correo,
       r.titular_telefono, r.total_venta_centavos AS total, r.anticipo_centavos AS anticipo, r.moneda_codigo AS moneda, r.creado_en, r.retenida_hasta
     FROM reservas.reservas r JOIN catalogo.hoteles h ON h.id = r.hotel_id
     WHERE ($1::text IS NULL OR r.estado = $1) AND ($2::uuid[] IS NULL OR h.organizacion_id = ANY($2::uuid[]))
     ORDER BY CASE r.estado WHEN 'solicitada' THEN 0 WHEN 'pendiente_pago' THEN 1 WHEN 'confirmada' THEN 2 ELSE 3 END, r.fecha_entrada
     LIMIT 300`,
    [filtro.estado ?? null, organizaciones],
  );
  return rows;
}
