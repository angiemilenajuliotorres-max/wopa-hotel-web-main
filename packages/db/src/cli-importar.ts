/**
 * Importa los datos de la web heredada al esquema nuevo, en una sola transacción (ADR-013).
 *   DATABASE_URL=… ADMIN_CORREO=ops@wopa.travel npm run db:importar-legado
 */
import pg from "pg";
import { importarLegado } from "./importar-legado.ts";

const { DATABASE_URL, ADMIN_CORREO } = process.env;
if (!DATABASE_URL || !ADMIN_CORREO) {
  console.error("Faltan variables: DATABASE_URL y ADMIN_CORREO (un usuario wopa_admin).");
  process.exit(1);
}

const cliente = new pg.Client({ connectionString: DATABASE_URL });
await cliente.connect();
try {
  await cliente.query("BEGIN");
  const resultado = await importarLegado(cliente, { correoAdmin: ADMIN_CORREO });
  await cliente.query("COMMIT");
  console.log(
    `Importado: ${resultado.hoteles} hoteles, ${resultado.experiencias} experiencias, ${resultado.reservas} reservas, ` +
      `${resultado.cotizaciones} cotizaciones, ${resultado.tickets} tickets, ${resultado.operacionesContables} operaciones contables, ` +
      `${resultado.eventosAuditoria} eventos de bitácora.`,
  );
  for (const aviso of resultado.avisos) console.warn(`Aviso: ${aviso}`);
} catch (error) {
  await cliente.query("ROLLBACK");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await cliente.end();
}
