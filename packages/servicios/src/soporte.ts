/**
 * Soporte (ADR-009): tickets con plazo de respuesta por categoría y centro de ayuda bilingüe.
 * El asistente con IA (fase 4) crea tickets con este mismo servicio.
 */
import { registrarEvento } from "./auditoria.ts";
import type { Idioma } from "./busqueda.ts";
import { db, enTransaccion, ErrorNegocio, type Consulta } from "./conexion.ts";
import { esWopa, type SesionActiva } from "./identidad.ts";
import { encolarCorreo } from "./notificaciones.ts";

export type Categoria = "en_el_hotel" | "pago" | "cancelacion" | "reserva" | "cuenta_hotel" | "otro";
export type OrigenTicket = "asistente" | "mi_reserva" | "contacto" | "extranet" | "correo";
const PRIORIDAD: Record<Categoria, "urgente" | "alta" | "media"> = {
  en_el_hotel: "urgente", pago: "alta", cancelacion: "alta", reserva: "media", cuenta_hotel: "media", otro: "media",
};

export async function crearTicket(
  datos: {
    categoria: Categoria;
    asunto: string;
    mensaje: string;
    nombre: string;
    correo: string;
    telefono?: string | null;
    idioma: Idioma;
    origen: OrigenTicket;
    reservaCodigo?: string | null;
    conversacionId?: string | null;
  },
  cliente?: Consulta,
): Promise<{ codigo: string; venceSlaEn: Date }> {
  const asunto = datos.asunto.trim();
  const mensaje = datos.mensaje.trim();
  if (asunto.length < 3) throw new ErrorNegocio("ASUNTO_INVALIDO", "Escribe un asunto.", { campo: "asunto" });
  if (mensaje.length < 5) throw new ErrorNegocio("MENSAJE_INVALIDO", "Cuéntanos qué necesitas.", { campo: "mensaje" });
  if (datos.nombre.trim().length < 2) throw new ErrorNegocio("NOMBRE_INVALIDO", "Escribe tu nombre.", { campo: "nombre" });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(datos.correo.trim())) throw new ErrorNegocio("CORREO_INVALIDO", "El correo no es válido.", { campo: "correo" });

  return enTransaccion(async (tx) => {
    const reserva = datos.reservaCodigo
      ? (await tx.query<{ id: string; hotel_id: string }>("SELECT id, hotel_id FROM reservas.reservas WHERE codigo = $1 AND titular_correo = $2", [
          datos.reservaCodigo.trim().toUpperCase(), datos.correo.trim().toLowerCase(),
        ])).rows[0]
      : undefined;
    const { rows } = await tx.query<{ id: string; codigo: string; vence_sla_en: Date }>(
      `INSERT INTO soporte.tickets (codigo, categoria_codigo, prioridad, origen, asunto, idioma_codigo, solicitante_nombre, solicitante_correo,
         solicitante_telefono, conversacion_id, reserva_id, hotel_id, vence_sla_en)
       SELECT 'TK-' || lpad(nextval('soporte.tickets_numero_seq')::text, 6, '0'), c.codigo, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
              now() + make_interval(hours => c.sla_horas)
       FROM soporte.categorias c WHERE c.codigo = $1
       RETURNING id, codigo, vence_sla_en`,
      [
        datos.categoria, PRIORIDAD[datos.categoria] ?? "media", datos.origen, asunto.slice(0, 200), datos.idioma, datos.nombre.trim(),
        datos.correo.trim().toLowerCase(), datos.telefono?.trim() || null, datos.conversacionId ?? null, reserva?.id ?? null, reserva?.hotel_id ?? null,
      ],
    );
    const ticket = rows[0];
    if (!ticket) throw new ErrorNegocio("CATEGORIA_INVALIDA", "Elige un tema.", { campo: "categoria" });
    await tx.query("INSERT INTO soporte.ticket_mensajes (ticket_id, autor, contenido) VALUES ($1, 'cliente', $2)", [ticket.id, mensaje.slice(0, 8000)]);

    const es = datos.idioma === "es";
    await encolarCorreo(
      {
        para: datos.correo,
        plantilla: "ticket_creado",
        idioma: datos.idioma,
        asunto: es ? `Recibimos tu consulta ${ticket.codigo}` : `We received your request ${ticket.codigo}`,
        texto: es
          ? `Hola ${datos.nombre.trim()}:\n\nRecibimos tu consulta "${asunto}". Nuestro equipo te responderá por este medio. Tu número de caso es ${ticket.codigo}.`
          : `Hi ${datos.nombre.trim()},\n\nWe received your request "${asunto}". Our team will reply by email. Your case number is ${ticket.codigo}.`,
      },
      tx,
    );
    await encolarCorreo(
      {
        para: process.env.CORREO_SOPORTE ?? "soporte@wopa.travel",
        plantilla: "ticket_nuevo_equipo",
        idioma: "es",
        asunto: `[${ticket.codigo}] ${PRIORIDAD[datos.categoria] === "urgente" ? "URGENTE · " : ""}${asunto}`,
        texto: `${datos.nombre} (${datos.correo}) escribió por ${datos.origen}:\n\n${mensaje}\n\nResponder antes de: ${new Date(ticket.vence_sla_en).toISOString()}`,
      },
      tx,
    );
    return { codigo: ticket.codigo, venceSlaEn: new Date(ticket.vence_sla_en) };
  }, cliente);
}

function exigirSoporte(sesion: SesionActiva): void {
  if (!esWopa(sesion, ["wopa_admin", "wopa_operaciones", "wopa_soporte"])) throw new ErrorNegocio("SIN_PERMISO", "Solo para el equipo de soporte.", { estado: 403 });
}

export async function listarTickets(sesion: SesionActiva, filtro: "abiertos" | "todos" = "abiertos", cliente?: Consulta) {
  exigirSoporte(sesion);
  const { rows } = await db(cliente).query<{
    id: string; codigo: string; asunto: string; estado: string; prioridad: string; categoria: string; origen: string;
    solicitante_nombre: string; solicitante_correo: string; vence_sla_en: Date; creado_en: Date; vencido: boolean; reserva: string | null;
  }>(
    `SELECT t.id, t.codigo, t.asunto, t.estado, t.prioridad, ct.nombre AS categoria, t.origen, t.solicitante_nombre, t.solicitante_correo,
       t.vence_sla_en, t.creado_en, (t.vence_sla_en < now() AND t.estado IN ('abierto', 'en_progreso')) AS vencido, r.codigo AS reserva
     FROM soporte.tickets t
     JOIN soporte.categoria_traducciones ct ON ct.categoria_codigo = t.categoria_codigo AND ct.idioma_codigo = 'es'
     LEFT JOIN reservas.reservas r ON r.id = t.reserva_id
     WHERE $1 = 'todos' OR t.estado IN ('abierto', 'en_progreso', 'esperando_cliente')
     ORDER BY CASE t.prioridad WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, t.vence_sla_en
     LIMIT 200`,
    [filtro],
  );
  return rows;
}

export async function detalleTicket(sesion: SesionActiva, ticketId: string, cliente?: Consulta) {
  exigirSoporte(sesion);
  const conexion = db(cliente);
  const ticket = (await conexion.query<Record<string, any>>(
    `SELECT t.*, r.codigo AS reserva_codigo, h.nombre AS hotel FROM soporte.tickets t
     LEFT JOIN reservas.reservas r ON r.id = t.reserva_id LEFT JOIN catalogo.hoteles h ON h.id = t.hotel_id WHERE t.id = $1`,
    [ticketId],
  )).rows[0];
  if (!ticket) return null;
  const mensajes = (await conexion.query<{ autor: string; contenido: string; es_nota_interna: boolean; creado_en: Date; nombre: string | null }>(
    `SELECT m.autor, m.contenido, m.es_nota_interna, m.creado_en, u.nombre FROM soporte.ticket_mensajes m
     LEFT JOIN identidad.usuarios u ON u.id = m.autor_usuario_id WHERE m.ticket_id = $1 ORDER BY m.creado_en, m.id`,
    [ticketId],
  )).rows;
  return Object.assign(ticket, { mensajes });
}

export async function responderTicket(
  sesion: SesionActiva,
  datos: { ticketId: string; contenido: string; notaInterna: boolean; nuevoEstado?: "en_progreso" | "esperando_cliente" | "resuelto" | "cerrado" },
  cliente?: Consulta,
): Promise<void> {
  exigirSoporte(sesion);
  const contenido = datos.contenido.trim();
  if (contenido.length < 2) throw new ErrorNegocio("MENSAJE_INVALIDO", "Escribe la respuesta.", { campo: "contenido" });
  await enTransaccion(async (tx) => {
    const ticket = (await tx.query<{ codigo: string; solicitante_correo: string; solicitante_nombre: string; idioma: Idioma; asunto: string; estado: string }>(
      "SELECT codigo, solicitante_correo, solicitante_nombre, idioma_codigo AS idioma, asunto, estado FROM soporte.tickets WHERE id = $1 FOR UPDATE",
      [datos.ticketId],
    )).rows[0];
    if (!ticket) throw new ErrorNegocio("TICKET_NO_ENCONTRADO", "El ticket no existe.", { estado: 404 });
    await tx.query(
      "INSERT INTO soporte.ticket_mensajes (ticket_id, autor, autor_usuario_id, contenido, es_nota_interna) VALUES ($1, 'equipo', $2, $3, $4)",
      [datos.ticketId, sesion.usuario.id, contenido, datos.notaInterna],
    );
    const estado = datos.nuevoEstado ?? (datos.notaInterna ? ticket.estado : "esperando_cliente");
    await tx.query(
      `UPDATE soporte.tickets SET estado = $2, asignado_a = coalesce(asignado_a, $3),
         resuelto_en = CASE WHEN $2 IN ('resuelto', 'cerrado') THEN coalesce(resuelto_en, now()) ELSE NULL END
       WHERE id = $1`,
      [datos.ticketId, estado, sesion.usuario.id],
    );
    if (!datos.notaInterna) {
      const es = ticket.idioma === "es";
      await encolarCorreo(
        {
          para: ticket.solicitante_correo,
          plantilla: "ticket_respuesta",
          idioma: ticket.idioma,
          asunto: `${es ? "Respuesta a tu consulta" : "Reply to your request"} ${ticket.codigo}: ${ticket.asunto}`,
          texto: `${es ? "Hola" : "Hi"} ${ticket.solicitante_nombre}:\n\n${contenido}\n\n— ${sesion.usuario.nombre}, WOPA Travel`,
        },
        tx,
      );
    }
    await registrarEvento({ entidad: "ticket", entidadId: datos.ticketId, accion: datos.notaInterna ? "nota_interna" : "respondido", actor: { tipo: "usuario", usuarioId: sesion.usuario.id }, despues: { estado } }, tx);
  }, cliente);
}

// ---------------------------------------------------------------- centro de ayuda

export async function listarArticulos(idioma: Idioma, cliente?: Consulta) {
  const { rows } = await db(cliente).query<{ codigo: string; slug: string; titulo: string; contenido: string }>(
    `SELECT a.codigo, t.slug, t.titulo, t.contenido FROM soporte.articulos_ayuda a
     JOIN soporte.articulo_traducciones t ON t.articulo_id = a.id AND t.idioma_codigo = $1
     WHERE a.esta_publicado ORDER BY a.orden, t.titulo`,
    [idioma],
  );
  return rows;
}

/** Búsqueda por similitud de texto, tolerante a tildes; la usa también el asistente. */
export async function buscarArticulos(texto: string, idioma: Idioma, cliente?: Consulta) {
  const termino = texto.trim();
  if (termino.length < 2) return [];
  const { rows } = await db(cliente).query<{ slug: string; titulo: string; contenido: string; puntaje: number }>(
    `SELECT t.slug, t.titulo, t.contenido,
       word_similarity(public.sin_acentos($1), public.sin_acentos(t.titulo || ' ' || t.contenido)) AS puntaje
     FROM soporte.articulo_traducciones t JOIN soporte.articulos_ayuda a ON a.id = t.articulo_id AND a.esta_publicado
     WHERE t.idioma_codigo = $2
     ORDER BY puntaje DESC LIMIT 3`,
    [termino, idioma],
  );
  return rows.filter((fila) => fila.puntaje > 0.2);
}

export async function listarCategorias(idioma: Idioma, cliente?: Consulta) {
  const { rows } = await db(cliente).query<{ codigo: Categoria; nombre: string }>(
    `SELECT c.codigo, t.nombre FROM soporte.categorias c JOIN soporte.categoria_traducciones t ON t.categoria_codigo = c.codigo AND t.idioma_codigo = $1
     WHERE c.codigo <> 'cuenta_hotel' ORDER BY c.sla_horas, t.nombre`,
    [idioma],
  );
  return rows;
}
