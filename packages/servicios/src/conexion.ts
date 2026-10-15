import pg from "pg";

// bigint (int8) y numeric llegan como texto: se convierten donde hace falta, sin perder precisión.

export interface Consulta {
  query<Fila = Record<string, any>>(sql: string, parametros?: unknown[]): Promise<{ rows: Fila[]; rowCount: number | null }>;
  /** true si la conexión ya está dentro de una transacción (las anidadas usan SAVEPOINT). */
  transaccional?: boolean;
}

function marcarTransaccional(conexion: Consulta): Consulta {
  return { query: (sql, parametros) => conexion.query(sql, parametros), transaccional: true };
}

let contadorPuntos = 0;

let pool: pg.Pool | undefined;

export function obtenerPool(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Falta DATABASE_URL (en local: docker compose up -d; ver .env.example).");
    pool = new pg.Pool({ connectionString: url, max: process.env.VERCEL ? 3 : 10, idleTimeoutMillis: 10_000 });
    pool.on("error", (error) => console.error("Error en la conexión PostgreSQL:", error.message));
  }
  return pool;
}

/** Usa el pool por defecto o un cliente inyectado (pruebas, transacciones externas). */
export function db(cliente?: Consulta): Consulta {
  return cliente ?? obtenerPool();
}

/**
 * Ejecuta `trabajo` de forma atómica:
 * - sin cliente: toma una conexión del pool y abre una transacción;
 * - con un cliente que ya está en una transacción: usa un SAVEPOINT (transacción anidada);
 * - con un cliente suelto (por ejemplo, en pruebas): abre la transacción sobre él.
 */
export async function enTransaccion<T>(trabajo: (tx: Consulta) => Promise<T>, cliente?: Consulta): Promise<T> {
  if (cliente && !(cliente instanceof pg.Pool)) {
    if (cliente.transaccional) {
      const punto = `punto_${++contadorPuntos}`;
      await cliente.query(`SAVEPOINT ${punto}`);
      try {
        const resultado = await trabajo(cliente);
        await cliente.query(`RELEASE SAVEPOINT ${punto}`);
        return resultado;
      } catch (error) {
        await cliente.query(`ROLLBACK TO SAVEPOINT ${punto}`);
        throw error;
      }
    }
    await cliente.query("BEGIN");
    try {
      const resultado = await trabajo(marcarTransaccional(cliente));
      await cliente.query("COMMIT");
      return resultado;
    } catch (error) {
      await cliente.query("ROLLBACK");
      throw error;
    }
  }
  const conexion = await obtenerPool().connect();
  try {
    await conexion.query("BEGIN");
    const resultado = await trabajo(marcarTransaccional(conexion));
    await conexion.query("COMMIT");
    return resultado;
  } catch (error) {
    await conexion.query("ROLLBACK");
    throw error;
  } finally {
    conexion.release();
  }
}

export async function cerrarPool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/** Error de negocio con un código estable que el frontend traduce. */
export class ErrorNegocio extends Error {
  readonly codigo: string;
  readonly estado: number;
  readonly campo?: string;
  constructor(codigo: string, mensaje: string, opciones: { estado?: number; campo?: string } = {}) {
    super(mensaje);
    this.name = "ErrorNegocio";
    this.codigo = codigo;
    this.estado = opciones.estado ?? 400;
    this.campo = opciones.campo;
  }
}
