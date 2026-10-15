import { db, type Consulta } from "./conexion.ts";

export type Actor =
  | { tipo: "usuario"; usuarioId: string; ip?: string | null }
  | { tipo: "sistema" | "asistente" | "proveedor"; ip?: string | null };

export async function registrarEvento(
  evento: {
    entidad: string;
    entidadId: string;
    accion: string;
    actor: Actor;
    antes?: unknown;
    despues?: unknown;
    detalle?: string;
  },
  cliente?: Consulta,
): Promise<void> {
  await db(cliente).query(
    `INSERT INTO auditoria.eventos (entidad, entidad_id, accion, antes, despues, detalle, actor_tipo, actor_usuario_id, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      evento.entidad,
      evento.entidadId,
      evento.accion,
      evento.antes === undefined ? null : JSON.stringify(evento.antes),
      evento.despues === undefined ? null : JSON.stringify(evento.despues),
      evento.detalle ?? null,
      evento.actor.tipo,
      evento.actor.tipo === "usuario" ? evento.actor.usuarioId : null,
      evento.actor.ip ?? null,
    ],
  );
}

export async function crearAlerta(
  alerta: {
    tipo: string;
    severidad: "info" | "advertencia" | "critica";
    hotelId?: string | null;
    entidad?: string;
    entidadId?: string;
    detalle?: Record<string, unknown>;
  },
  cliente?: Consulta,
): Promise<void> {
  // Una alerta abierta por tipo y entidad (índice único parcial): si ya existe, no se repite.
  await db(cliente).query(
    `INSERT INTO auditoria.alertas (tipo, severidad, hotel_id, entidad, entidad_id, detalle)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
    [alerta.tipo, alerta.severidad, alerta.hotelId ?? null, alerta.entidad ?? null, alerta.entidadId ?? null, JSON.stringify(alerta.detalle ?? {})],
  );
}
