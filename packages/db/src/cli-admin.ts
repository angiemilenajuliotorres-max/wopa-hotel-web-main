/**
 * Crea el primer administrador de WOPA.
 *   ADMIN_CORREO=ops@wopa.travel ADMIN_NOMBRE="Operaciones" ADMIN_CLAVE="…" npm run admin:crear
 * La clave se pide por variable de entorno para que no quede en el historial de la terminal.
 * Al primer inicio de sesión, el panel exige configurar la verificación en dos pasos.
 */
import pg from "pg";
import { crearAdministradorWopa } from "./administradores.ts";

const { DATABASE_URL, ADMIN_CORREO, ADMIN_NOMBRE, ADMIN_CLAVE } = process.env;
if (!DATABASE_URL || !ADMIN_CORREO || !ADMIN_NOMBRE || !ADMIN_CLAVE) {
  console.error("Faltan variables: DATABASE_URL, ADMIN_CORREO, ADMIN_NOMBRE y ADMIN_CLAVE.");
  process.exit(1);
}

const cliente = new pg.Client({ connectionString: DATABASE_URL });
await cliente.connect();
try {
  const { creado } = await crearAdministradorWopa(cliente, { correo: ADMIN_CORREO, nombre: ADMIN_NOMBRE, clave: ADMIN_CLAVE });
  console.log(creado ? `Administrador creado: ${ADMIN_CORREO}` : `Usuario existente promovido a wopa_admin y clave actualizada: ${ADMIN_CORREO}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await cliente.end();
}
