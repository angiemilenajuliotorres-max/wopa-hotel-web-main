import { hashearClave } from "@wopa/dominio/identidad";
import type { ClienteSql } from "./importar-legado.ts";

/**
 * Crea (o promueve) un usuario con rol wopa_admin en la organización WOPA.
 * Se usa para el primer acceso; los siguientes usuarios se invitan desde el panel.
 */
export async function crearAdministradorWopa(
  db: ClienteSql,
  datos: { correo: string; nombre: string; clave: string },
): Promise<{ usuarioId: string; creado: boolean }> {
  const organizacion = (await db.query<{ id: string }>("SELECT id FROM identidad.organizaciones WHERE tipo = 'wopa' ORDER BY creado_en LIMIT 1")).rows[0];
  if (!organizacion) throw new Error("No existe la organización WOPA: aplica las migraciones primero.");

  const claveHash = await hashearClave(datos.clave);
  const existente = (await db.query<{ id: string }>("SELECT id FROM identidad.usuarios WHERE correo = $1", [datos.correo])).rows[0];
  const usuarioId =
    existente?.id ??
    (await db.query<{ id: string }>("INSERT INTO identidad.usuarios (correo, nombre) VALUES ($1, $2) RETURNING id", [datos.correo, datos.nombre])).rows[0].id;

  await db.query(
    `INSERT INTO identidad.credenciales (usuario_id, clave_hash) VALUES ($1, $2)
     ON CONFLICT (usuario_id) DO UPDATE SET clave_hash = EXCLUDED.clave_hash`,
    [usuarioId, claveHash],
  );
  await db.query(
    `INSERT INTO identidad.membresias (usuario_id, organizacion_id, organizacion_tipo, rol) VALUES ($1, $2, 'wopa', 'wopa_admin')
     ON CONFLICT (usuario_id, organizacion_id) DO UPDATE SET rol = 'wopa_admin'`,
    [usuarioId, organizacion.id],
  );
  return { usuarioId, creado: !existente };
}
