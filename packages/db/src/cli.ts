/**
 * Aplica las migraciones pendientes en la base de DATABASE_URL.
 *   Local:  DATABASE_URL=postgres://wopa:wopa_local@localhost:5433/wopa npm run db:migrar
 *   Neon:   DATABASE_URL=<cadena de la rama de Neon> npm run db:migrar
 */
import pg from "pg";
import { migrar } from "./migrador.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL. En local: docker compose up -d y usa postgres://wopa:wopa_local@localhost:5433/wopa.");
  process.exit(1);
}

// Un solo cliente: el bloqueo de migración es por sesión.
const cliente = new pg.Client({ connectionString: url });
await cliente.connect();

try {
  const resultado = await migrar({
    exec: (sql) => cliente.query(sql),
    query: async <Fila,>(sql: string, parametros?: unknown[]) =>
      (await cliente.query(sql, parametros)) as unknown as { rows: Fila[] },
  });
  if (resultado.aplicadas.length === 0) {
    console.log(`Sin migraciones pendientes (${resultado.yaAplicadas} ya aplicadas).`);
  } else {
    for (const nombre of resultado.aplicadas) console.log(`Aplicada ${nombre}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await cliente.end();
}
