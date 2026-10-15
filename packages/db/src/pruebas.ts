/**
 * Bases de datos temporales para pruebas, en el Postgres de Docker (docker compose up -d)
 * o en el de PRUEBAS_DATABASE_URL. Cada una se elimina con close().
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { migrar, type Ejecutor } from "./migrador.ts";

/** Postgres 18 de pruebas: el de Docker (docker compose up -d) salvo que se indique otro. */
const URL_SERVIDOR = process.env.PRUEBAS_DATABASE_URL ?? "postgres://wopa:wopa_local@localhost:5433/wopa";

export interface BaseDePrueba extends Ejecutor {
  /** Cadena de conexión de la base temporal. */
  url: string;
  query<Fila = Record<string, unknown>>(sql: string, parametros?: unknown[]): Promise<{ rows: Fila[]; rowCount: number }>;
  /** Cierra la conexión y elimina la base temporal. */
  close(): Promise<void>;
}

async function conectar(url: string): Promise<pg.Client> {
  const cliente = new pg.Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No hay Postgres de pruebas en ${new URL(url).host}. Levántalo con \`docker compose up -d\` o define PRUEBAS_DATABASE_URL. (${detalle})`,
    );
  }
  return cliente;
}

/** Crea una base de datos temporal y vacía en el servidor de pruebas. */
export async function crearBaseVacia(): Promise<BaseDePrueba> {
  const nombre = `wopa_prueba_${randomBytes(6).toString("hex")}`;
  const admin = await conectar(URL_SERVIDOR);
  try {
    await admin.query(`CREATE DATABASE ${nombre}`);
  } finally {
    await admin.end();
  }
  const url = new URL(URL_SERVIDOR);
  url.pathname = `/${nombre}`;
  const cliente = await conectar(url.toString());

  return {
    url: url.toString(),
    exec: (sql) => cliente.query(sql),
    async query<Fila>(sql: string, parametros?: unknown[]) {
      const resultado = await cliente.query(sql, parametros);
      return { rows: resultado.rows as Fila[], rowCount: resultado.rowCount ?? 0 };
    },
    async close() {
      await cliente.end();
      const limpieza = await conectar(URL_SERVIDOR);
      try {
        await limpieza.query(`DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`);
      } finally {
        await limpieza.end();
      }
    },
  };
}

export async function crearBaseMigrada(): Promise<BaseDePrueba> {
  const db = await crearBaseVacia();
  await migrar(db);
  return db;
}

