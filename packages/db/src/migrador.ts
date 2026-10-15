import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Conexión mínima que necesita el migrador. La cumplen PGlite y un cliente de
 * @neondatabase/serverless (o node-postgres) sin adaptadores adicionales.
 */
export interface Ejecutor {
  /** Ejecuta una o varias sentencias sin parámetros. */
  exec(sql: string): Promise<unknown>;
  query<Fila>(sql: string, parametros?: unknown[]): Promise<{ rows: Fila[] }>;
}

export interface Migracion {
  version: string; // "0001"
  nombre: string; // "base"
  sql: string;
  checksum: string; // sha256 del SQL con saltos de línea normalizados
}

export class MigracionModificada extends Error {
  constructor(version: string) {
    super(
      `La migración ${version} ya está aplicada y su archivo cambió. ` +
        "Las migraciones publicadas no se editan: crea una nueva.",
    );
    this.name = "MigracionModificada";
  }
}

export const CARPETA_MIGRACIONES = fileURLToPath(new URL("../migraciones/", import.meta.url));

const PATRON_ARCHIVO = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const CLAVE_BLOQUEO = 7_270_001; // pg_advisory_lock: evita dos migraciones a la vez

function huella(sql: string): string {
  // Windows guarda CRLF y Linux LF: la huella no debe depender del sistema.
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
}

export async function leerMigraciones(carpeta: string = CARPETA_MIGRACIONES): Promise<Migracion[]> {
  const archivos = (await readdir(carpeta)).filter((archivo) => archivo.endsWith(".sql")).sort();
  const migraciones: Migracion[] = [];
  const versiones = new Set<string>();

  for (const archivo of archivos) {
    const coincidencia = PATRON_ARCHIVO.exec(archivo);
    if (!coincidencia) throw new Error(`Nombre de migración inválido: ${archivo} (formato NNNN_nombre.sql).`);
    const [, version, nombre] = coincidencia;
    if (versiones.has(version)) throw new Error(`Versión de migración duplicada: ${version}.`);
    versiones.add(version);
    const sql = await readFile(path.join(carpeta, archivo), "utf8");
    migraciones.push({ version, nombre, sql, checksum: huella(sql) });
  }
  return migraciones;
}

/**
 * Aplica, en orden y cada una en su propia transacción, las migraciones pendientes.
 * Falla si una migración ya aplicada fue modificada.
 */
export async function migrar(
  db: Ejecutor,
  opciones: { carpeta?: string } = {},
): Promise<{ aplicadas: string[]; yaAplicadas: number }> {
  const migraciones = await leerMigraciones(opciones.carpeta);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.migraciones_aplicadas (
      version     text PRIMARY KEY,
      nombre      text NOT NULL,
      checksum    text NOT NULL,
      aplicada_en timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.query("SELECT pg_advisory_lock($1)", [CLAVE_BLOQUEO]);

  try {
    const { rows } = await db.query<{ version: string; checksum: string }>(
      "SELECT version, checksum FROM public.migraciones_aplicadas",
    );
    const registradas = new Map(rows.map((fila) => [fila.version, fila.checksum]));
    const aplicadas: string[] = [];

    for (const migracion of migraciones) {
      const checksumRegistrado = registradas.get(migracion.version);
      if (checksumRegistrado !== undefined) {
        if (checksumRegistrado !== migracion.checksum) throw new MigracionModificada(migracion.version);
        continue;
      }

      // version, nombre y checksum solo admiten [0-9a-z_], así que pueden ir en el SQL.
      try {
        await db.exec(
          `BEGIN;\n${migracion.sql}\n;\n` +
            "INSERT INTO public.migraciones_aplicadas (version, nombre, checksum) " +
            `VALUES ('${migracion.version}', '${migracion.nombre}', '${migracion.checksum}');\n` +
            "COMMIT;",
        );
      } catch (error) {
        await db.exec("ROLLBACK").catch(() => {});
        const detalle = error instanceof Error ? error.message : String(error);
        throw new Error(`Falló la migración ${migracion.version}_${migracion.nombre}: ${detalle}`, { cause: error });
      }
      aplicadas.push(`${migracion.version}_${migracion.nombre}`);
    }

    return { aplicadas, yaAplicadas: registradas.size };
  } finally {
    await db.query("SELECT pg_advisory_unlock($1)", [CLAVE_BLOQUEO]);
  }
}
