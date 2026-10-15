/**
 * Extranet de hoteles y supervisión de WOPA (ADR-004, fase 5):
 * revisión de cambios de contenido, calendario de tarifa neta y cupos, semáforo de salud y alertas.
 */
import { crearAlerta, registrarEvento } from "./auditoria.ts";
import { db, enTransaccion, ErrorNegocio, type Consulta } from "./conexion.ts";
import { esWopa, hotelesDe, type SesionActiva } from "./identidad.ts";
import { encolarCorreo } from "./notificaciones.ts";

async function organizacionDe(conexion: Consulta, hotelId: string): Promise<string | null> {
  return (await conexion.query<{ organizacion_id: string }>("SELECT organizacion_id FROM catalogo.hoteles WHERE id = $1", [hotelId])).rows[0]?.organizacion_id ?? null;
}

async function exigirHotel(sesion: SesionActiva, hotelId: string, conexion: Consulta): Promise<void> {
  if (esWopa(sesion, ["wopa_admin", "wopa_operaciones"])) return;
  const organizacion = await organizacionDe(conexion, hotelId);
  if (!organizacion || !hotelesDe(sesion).includes(organizacion)) throw new ErrorNegocio("SIN_PERMISO", "No tienes acceso a este hotel.", { estado: 403 });
}

/** Hoteles que puede gestionar la sesión (WOPA ve todos). */
export async function hotelesDeSesion(sesion: SesionActiva, cliente?: Consulta) {
  const organizaciones = esWopa(sesion, ["wopa_admin", "wopa_operaciones"]) ? null : hotelesDe(sesion);
  const { rows } = await db(cliente).query<{ id: string; nombre: string; slug: string; estado: string; modo_reserva: string; ciudad: string }>(
    `SELECT h.id, h.nombre, h.slug, h.estado, h.modo_reserva, ct.nombre AS ciudad
     FROM catalogo.hoteles h JOIN geo.ciudad_traducciones ct ON ct.ciudad_id = h.ciudad_id AND ct.idioma_codigo = 'es'
     WHERE h.eliminado_en IS NULL AND ($1::uuid[] IS NULL OR h.organizacion_id = ANY($1::uuid[])) ORDER BY h.nombre`,
    [organizaciones],
  );
  return rows;
}

// ---------------------------------------------------------------- revisión de contenido

export interface CambioContenido {
  idioma: "es" | "en";
  descripcion: string;
  comoLlegar?: string | null;
}

/** El hotel propone un cambio de descripción; queda pendiente hasta que WOPA lo aprueba. */
export async function proponerCambioContenido(sesion: SesionActiva, hotelId: string, cambio: CambioContenido, cliente?: Consulta): Promise<string> {
  const descripcion = cambio.descripcion.trim();
  if (descripcion.length < 20) throw new ErrorNegocio("DESCRIPCION_CORTA", "La descripción debe tener al menos 20 caracteres.", { campo: "descripcion" });
  return enTransaccion(async (tx) => {
    await exigirHotel(sesion, hotelId, tx);
    const actual = (await tx.query<{ descripcion: string; como_llegar: string | null }>(
      "SELECT descripcion, como_llegar FROM catalogo.hotel_traducciones WHERE hotel_id = $1 AND idioma_codigo = $2", [hotelId, cambio.idioma],
    )).rows[0] ?? null;
    const id = (await tx.query<{ id: string }>(
      "INSERT INTO catalogo.revisiones_contenido (hotel_id, cambios, solicitado_por) VALUES ($1, $2, $3) RETURNING id",
      [hotelId, JSON.stringify({ tipo: "traduccion", idioma: cambio.idioma, antes: actual, despues: { descripcion, como_llegar: cambio.comoLlegar?.trim() || null } }), sesion.usuario.id],
    )).rows[0].id;
    await registrarEvento({ entidad: "hotel", entidadId: hotelId, accion: "cambio_contenido_propuesto", actor: { tipo: "usuario", usuarioId: sesion.usuario.id }, despues: { revision: id } }, tx);
    return id;
  }, cliente);
}

export async function listarRevisiones(sesion: SesionActiva, cliente?: Consulta) {
  if (!esWopa(sesion, ["wopa_admin", "wopa_operaciones"])) throw new ErrorNegocio("SIN_PERMISO", "Solo para operaciones de WOPA.", { estado: 403 });
  const { rows } = await db(cliente).query<{ id: string; hotel: string; hotel_id: string; cambios: { idioma: string; antes: { descripcion: string } | null; despues: { descripcion: string; como_llegar: string | null } }; solicitado_por: string; creado_en: Date }>(
    `SELECT r.id, h.nombre AS hotel, h.id AS hotel_id, r.cambios, u.nombre AS solicitado_por, r.creado_en
     FROM catalogo.revisiones_contenido r JOIN catalogo.hoteles h ON h.id = r.hotel_id JOIN identidad.usuarios u ON u.id = r.solicitado_por
     WHERE r.estado = 'pendiente' ORDER BY r.creado_en`,
  );
  return rows;
}

/** WOPA aprueba (y se publica) o rechaza un cambio; el hotel recibe el resultado por correo. */
export async function resolverRevision(sesion: SesionActiva, revisionId: string, aprobar: boolean, comentario: string | null, cliente?: Consulta): Promise<void> {
  if (!esWopa(sesion, ["wopa_admin", "wopa_operaciones"])) throw new ErrorNegocio("SIN_PERMISO", "Solo para operaciones de WOPA.", { estado: 403 });
  await enTransaccion(async (tx) => {
    const revision = (await tx.query<{ hotel_id: string; cambios: { idioma: string; despues: { descripcion: string; como_llegar: string | null } }; correo: string; hotel: string }>(
      `UPDATE catalogo.revisiones_contenido r SET estado = $2, revisado_por = $3, revisado_en = now(), comentario = $4
       FROM identidad.usuarios u, catalogo.hoteles h
       WHERE r.id = $1 AND r.estado = 'pendiente' AND u.id = r.solicitado_por AND h.id = r.hotel_id
       RETURNING r.hotel_id, r.cambios, u.correo, h.nombre AS hotel`,
      [revisionId, aprobar ? "aprobada" : "rechazada", sesion.usuario.id, comentario?.trim() || null],
    )).rows[0];
    if (!revision) throw new ErrorNegocio("ESTADO_INVALIDO", "La revisión ya fue resuelta.", { estado: 409 });
    if (aprobar) {
      await tx.query(
        `INSERT INTO catalogo.hotel_traducciones (hotel_id, idioma_codigo, descripcion, como_llegar, esta_revisada)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (hotel_id, idioma_codigo) DO UPDATE SET descripcion = EXCLUDED.descripcion, como_llegar = EXCLUDED.como_llegar, esta_revisada = true`,
        [revision.hotel_id, revision.cambios.idioma, revision.cambios.despues.descripcion, revision.cambios.despues.como_llegar],
      );
    }
    await encolarCorreo(
      {
        para: revision.correo,
        plantilla: "revision_contenido",
        idioma: "es",
        asunto: `${aprobar ? "Publicamos" : "No publicamos"} el cambio de ${revision.hotel}`,
        texto: aprobar
          ? `WOPA revisó y publicó el cambio de descripción (${revision.cambios.idioma}) de ${revision.hotel}.`
          : `WOPA no publicó el cambio de descripción de ${revision.hotel}.${comentario ? `\n\nComentario: ${comentario}` : ""}`,
      },
      tx,
    );
    await registrarEvento({ entidad: "revision_contenido", entidadId: revisionId, accion: aprobar ? "aprobada" : "rechazada", actor: { tipo: "usuario", usuarioId: sesion.usuario.id }, detalle: comentario ?? undefined }, tx);
  }, cliente);
}

// ---------------------------------------------------------------- calendario

/** Calendario por día de una habitación: tarifa neta por ocupación, cupo total, vendido y cierre. */
export async function calendarioHabitacion(sesion: SesionActiva, datos: { hotelId: string; tipoHabitacionId: string; desde: string; dias: number }, cliente?: Consulta) {
  const conexion = db(cliente);
  await exigirHotel(sesion, datos.hotelId, conexion);
  const dias = Math.min(Math.max(datos.dias, 1), 62);
  const { rows } = await conexion.query<{ fecha: string; netos: Record<string, string> | null; cupo_total: number | null; cupo_vendido: number | null; esta_cerrado: boolean | null }>(
    `SELECT d::date::text AS fecha,
       (SELECT jsonb_object_agg(p.ocupacion, p.monto_neto_centavos) FROM tarifas.precios_dia p
        WHERE p.tipo_habitacion_id = $1 AND p.fecha = d::date) AS netos,
       c.cupo_total, c.cupo_vendido, c.esta_cerrado
     FROM generate_series($2::date, $2::date + ($3::int - 1), '1 day') d
     LEFT JOIN tarifas.cupos_dia c ON c.tipo_habitacion_id = $1 AND c.fecha = d::date
     WHERE EXISTS (SELECT 1 FROM catalogo.tipos_habitacion t WHERE t.id = $1 AND t.hotel_id = $4)
     ORDER BY d`,
    [datos.tipoHabitacionId, datos.desde, dias, datos.hotelId],
  );
  return rows;
}

export async function liquidacionesDeHotel(sesion: SesionActiva, hotelId: string, cliente?: Consulta) {
  const conexion = db(cliente);
  await exigirHotel(sesion, hotelId, conexion);
  const { rows } = await conexion.query<{ id: string; periodo_desde: string; periodo_hasta: string; estado: string; moneda_codigo: string; total: string; referencia_transferencia: string | null; pagado_en: Date | null }>(
    `SELECT l.id, l.periodo_desde::text, l.periodo_hasta::text, l.estado, l.moneda_codigo,
       (SELECT coalesce(sum(monto_centavos), 0) FROM pagos.liquidacion_lineas ll WHERE ll.liquidacion_id = l.id) AS total,
       l.referencia_transferencia, l.pagado_en
     FROM pagos.liquidaciones l WHERE l.hotel_id = $1 ORDER BY l.periodo_desde DESC`,
    [hotelId],
  );
  return rows;
}

// ---------------------------------------------------------------- salud y alertas

export type Semaforo = "verde" | "amarillo" | "rojo";

/** Semáforo por hotel con los indicadores que WOPA vigila. */
export async function saludHoteles(sesion: SesionActiva, cliente?: Consulta) {
  if (!esWopa(sesion)) throw new ErrorNegocio("SIN_PERMISO", "Solo para el equipo de WOPA.", { estado: 403 });
  const { rows } = await db(cliente).query<{
    id: string; nombre: string; estado: string; modo_reserva: string; alertas: number; tickets_abiertos: number;
    solicitudes: number; rechazadas: number; sin_ingles: boolean; dias_sin_cupo: number; revisiones_pendientes: number;
  }>(
    `SELECT h.id, h.nombre, h.estado, h.modo_reserva,
       (SELECT count(*)::int FROM auditoria.alertas a WHERE a.hotel_id = h.id AND a.estado = 'abierta') AS alertas,
       (SELECT count(*)::int FROM soporte.tickets t WHERE t.hotel_id = h.id AND t.estado IN ('abierto', 'en_progreso')) AS tickets_abiertos,
       (SELECT count(*)::int FROM reservas.historial_estados he JOIN reservas.reservas r ON r.id = he.reserva_id
        WHERE r.hotel_id = h.id AND he.estado_nuevo = 'solicitada' AND he.creado_en > now() - interval '90 days') AS solicitudes,
       (SELECT count(*)::int FROM reservas.reservas r WHERE r.hotel_id = h.id AND r.estado = 'rechazada' AND r.creado_en > now() - interval '90 days') AS rechazadas,
       NOT EXISTS (SELECT 1 FROM catalogo.hotel_traducciones tr WHERE tr.hotel_id = h.id AND tr.idioma_codigo = 'en') AS sin_ingles,
       CASE WHEN h.modo_reserva = 'anticipo_en_linea' THEN (
         SELECT count(*)::int FROM generate_series(current_date, current_date + 29, '1 day') d
         WHERE NOT EXISTS (SELECT 1 FROM tarifas.cupos_dia c JOIN catalogo.tipos_habitacion t ON t.id = c.tipo_habitacion_id
                           WHERE t.hotel_id = h.id AND c.fecha = d::date AND NOT c.esta_cerrado AND c.cupo_total > c.cupo_vendido)
       ) ELSE 0 END AS dias_sin_cupo,
       (SELECT count(*)::int FROM catalogo.revisiones_contenido rc WHERE rc.hotel_id = h.id AND rc.estado = 'pendiente') AS revisiones_pendientes
     FROM catalogo.hoteles h WHERE h.eliminado_en IS NULL ORDER BY h.nombre`,
  );
  return rows.map((h) => {
    const tasaRechazo = h.solicitudes > 0 ? h.rechazadas / h.solicitudes : 0;
    const motivos: string[] = [];
    if (h.alertas > 0) motivos.push(`${h.alertas} alertas abiertas`);
    if (h.tickets_abiertos > 0) motivos.push(`${h.tickets_abiertos} tickets abiertos`);
    if (tasaRechazo > 0.3) motivos.push(`rechaza ${Math.round(tasaRechazo * 100)} % de las solicitudes`);
    if (h.dias_sin_cupo >= 14) motivos.push(`${h.dias_sin_cupo} de los próximos 30 días sin cupo`);
    if (h.sin_ingles) motivos.push("sin descripción en inglés");
    if (h.revisiones_pendientes > 0) motivos.push(`${h.revisiones_pendientes} cambios por revisar`);
    const semaforo: Semaforo = h.alertas > 0 || tasaRechazo > 0.5 || h.dias_sin_cupo >= 20 ? "rojo" : motivos.length > 0 ? "amarillo" : "verde";
    return { ...h, tasaRechazo, semaforo, motivos };
  });
}

/** Revisión diaria (cron): crea alertas para que WOPA actúe. Devuelve cuántas se intentaron crear. */
export async function generarAlertas(cliente?: Consulta): Promise<number> {
  const conexion = db(cliente);
  let total = 0;
  const sinCupo = (await conexion.query<{ id: string; dias: number }>(
    `SELECT h.id, (SELECT count(*)::int FROM generate_series(current_date, current_date + 29, '1 day') d
       WHERE NOT EXISTS (SELECT 1 FROM tarifas.cupos_dia c JOIN catalogo.tipos_habitacion t ON t.id = c.tipo_habitacion_id
                         WHERE t.hotel_id = h.id AND c.fecha = d::date AND NOT c.esta_cerrado AND c.cupo_total > c.cupo_vendido)) AS dias
     FROM catalogo.hoteles h WHERE h.estado = 'publicado' AND h.modo_reserva = 'anticipo_en_linea'`,
  )).rows.filter((h) => h.dias >= 14);
  for (const hotel of sinCupo) {
    await crearAlerta({ tipo: "sin_cupo_prolongado", severidad: "advertencia", hotelId: hotel.id, entidad: "hotel", entidadId: hotel.id, detalle: { diasSinCupo: hotel.dias } }, conexion);
    total++;
  }
  const vencidos = (await conexion.query<{ id: string; codigo: string; hotel_id: string | null }>(
    "SELECT id, codigo, hotel_id FROM soporte.tickets WHERE prioridad = 'urgente' AND estado IN ('abierto', 'en_progreso') AND vence_sla_en < now()",
  )).rows;
  for (const ticket of vencidos) {
    await crearAlerta({ tipo: "ticket_urgente_vencido", severidad: "critica", hotelId: ticket.hotel_id, entidad: "ticket", entidadId: ticket.id, detalle: { codigo: ticket.codigo } }, conexion);
    total++;
  }
  const sinIngles = (await conexion.query<{ id: string }>(
    `SELECT h.id FROM catalogo.hoteles h WHERE h.estado = 'publicado'
     AND NOT EXISTS (SELECT 1 FROM catalogo.hotel_traducciones tr WHERE tr.hotel_id = h.id AND tr.idioma_codigo = 'en')`,
  )).rows;
  for (const hotel of sinIngles) {
    await crearAlerta({ tipo: "traducciones_faltantes", severidad: "info", hotelId: hotel.id, entidad: "hotel", entidadId: hotel.id, detalle: { idioma: "en" } }, conexion);
    total++;
  }
  return total;
}
