/**
 * Reseñas verificadas (fase 6): solo huéspedes con estadía completada, una por reserva,
 * con moderación de WOPA antes de publicarse. El acceso es código + correo, como "Mi reserva".
 */
import { registrarEvento } from "./auditoria.ts";
import type { Idioma } from "./busqueda.ts";
import { db, enTransaccion, ErrorNegocio, type Consulta } from "./conexion.ts";
import { esWopa, type SesionActiva } from "./identidad.ts";
import { encolarCorreo } from "./notificaciones.ts";
import { consultarReserva } from "./reservas.ts";

export async function crearResena(
  datos: { codigo: string; correo: string; puntaje: number; comentario?: string | null; nombreVisible: string; idioma: Idioma },
  cliente?: Consulta,
): Promise<void> {
  if (!Number.isInteger(datos.puntaje) || datos.puntaje < 1 || datos.puntaje > 5) throw new ErrorNegocio("PUNTAJE_INVALIDO", "Elige de 1 a 5 estrellas.", { campo: "puntaje" });
  const comentario = datos.comentario?.trim() || null;
  if (comentario && comentario.length < 10) throw new ErrorNegocio("COMENTARIO_CORTO", "El comentario debe tener al menos 10 caracteres.", { campo: "comentario" });
  await enTransaccion(async (tx) => {
    const reserva = await consultarReserva(datos.codigo, datos.correo, tx);
    if (!reserva) throw new ErrorNegocio("RESERVA_NO_ENCONTRADA", "No encontramos una reserva con ese código y correo.", { estado: 404 });
    if (reserva.estado !== "completada") throw new ErrorNegocio("NO_RESENABLE", "Solo puedes opinar después de tu estadía.", { estado: 409 });
    const hotelId = (await tx.query<{ hotel_id: string }>("SELECT hotel_id FROM reservas.reservas WHERE id = $1", [reserva.id])).rows[0].hotel_id;
    const { rowCount } = await tx.query(
      `INSERT INTO reservas.resenas (reserva_id, hotel_id, puntaje, comentario, idioma_codigo, nombre_visible)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (reserva_id) DO NOTHING`,
      [reserva.id, hotelId, datos.puntaje, comentario, datos.idioma, datos.nombreVisible.trim().slice(0, 60) || "Huésped"],
    );
    if (!rowCount) throw new ErrorNegocio("RESENA_EXISTENTE", "Ya dejaste tu opinión sobre esta estadía. ¡Gracias!", { estado: 409 });
  }, cliente);
}

/** Publicadas de un hotel, con promedio y cantidad. */
export async function resenasDeHotel(hotelSlug: string, cliente?: Consulta) {
  const conexion = db(cliente);
  const resumen = (await conexion.query<{ promedio: string | null; cantidad: number }>(
    `SELECT round(avg(r.puntaje)::numeric, 1)::text AS promedio, count(*)::int AS cantidad
     FROM reservas.resenas r JOIN catalogo.hoteles h ON h.id = r.hotel_id WHERE h.slug = $1 AND r.estado = 'publicada'`,
    [hotelSlug],
  )).rows[0];
  const ultimas = (await conexion.query<{ puntaje: number; comentario: string | null; nombre_visible: string; idioma: string; creado_en: Date }>(
    `SELECT r.puntaje, r.comentario, r.nombre_visible, r.idioma_codigo AS idioma, r.creado_en
     FROM reservas.resenas r JOIN catalogo.hoteles h ON h.id = r.hotel_id
     WHERE h.slug = $1 AND r.estado = 'publicada' ORDER BY r.creado_en DESC LIMIT 10`,
    [hotelSlug],
  )).rows;
  return { promedio: resumen.promedio ? Number(resumen.promedio) : null, cantidad: resumen.cantidad, ultimas };
}

export async function resenasPendientes(sesion: SesionActiva, cliente?: Consulta) {
  if (!esWopa(sesion, ["wopa_admin", "wopa_operaciones", "wopa_soporte"])) throw new ErrorNegocio("SIN_PERMISO", "Solo para el equipo de WOPA.", { estado: 403 });
  const { rows } = await db(cliente).query<{ id: string; hotel: string; puntaje: number; comentario: string | null; nombre_visible: string; creado_en: Date }>(
    `SELECT r.id, h.nombre AS hotel, r.puntaje, r.comentario, r.nombre_visible, r.creado_en
     FROM reservas.resenas r JOIN catalogo.hoteles h ON h.id = r.hotel_id WHERE r.estado = 'pendiente' ORDER BY r.creado_en`,
  );
  return rows;
}

export async function moderarResena(sesion: SesionActiva, resenaId: string, publicar: boolean, cliente?: Consulta): Promise<void> {
  if (!esWopa(sesion, ["wopa_admin", "wopa_operaciones", "wopa_soporte"])) throw new ErrorNegocio("SIN_PERMISO", "Solo para el equipo de WOPA.", { estado: 403 });
  const { rowCount } = await db(cliente).query(
    "UPDATE reservas.resenas SET estado = $2, moderada_por = $3, moderada_en = now() WHERE id = $1 AND estado = 'pendiente'",
    [resenaId, publicar ? "publicada" : "rechazada", sesion.usuario.id],
  );
  if (!rowCount) throw new ErrorNegocio("ESTADO_INVALIDO", "La reseña ya fue moderada.", { estado: 409 });
  await registrarEvento({ entidad: "resena", entidadId: resenaId, accion: publicar ? "publicada" : "rechazada", actor: { tipo: "usuario", usuarioId: sesion.usuario.id } }, cliente);
}

/** Cron diario: invita a opinar a quienes completaron su estadía (una sola vez por reserva). */
export async function invitarAResenar(urlBase: string, cliente?: Consulta): Promise<number> {
  const conexion = db(cliente);
  const reservas = (await conexion.query<{ id: string; codigo: string; titular_nombre: string; titular_correo: string; idioma: Idioma; hotel: string }>(
    `UPDATE reservas.reservas r SET resena_solicitada_en = now() FROM catalogo.hoteles h
     WHERE h.id = r.hotel_id AND r.estado = 'completada' AND r.resena_solicitada_en IS NULL AND r.fecha_salida >= current_date - 14
     RETURNING r.id, r.codigo, r.titular_nombre, r.titular_correo, r.idioma_codigo AS idioma, h.nombre AS hotel`,
  )).rows;
  for (const r of reservas) {
    const es = r.idioma === "es";
    await encolarCorreo(
      {
        para: r.titular_correo,
        plantilla: "invitacion_resena",
        idioma: r.idioma,
        asunto: es ? `¿Cómo estuvo ${r.hotel}?` : `How was ${r.hotel}?`,
        texto: es
          ? `Hola ${r.titular_nombre}:\n\nCuéntanos cómo te fue en ${r.hotel}. Tu opinión ayuda a otros viajeros:\n${urlBase.replace(/\/$/, "")}/es/opinar?codigo=${r.codigo}`
          : `Hi ${r.titular_nombre},\n\nTell us about your stay at ${r.hotel}. Your review helps other travelers:\n${urlBase.replace(/\/$/, "")}/en/opinar?codigo=${r.codigo}`,
      },
      conexion,
    );
  }
  return reservas.length;
}
