import { randomBytes } from "node:crypto";
import pg from "pg";
import { migrar, type Ejecutor } from "../src/index.ts";

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

/** Devuelve el id de la primera fila. */
export async function insertar(db: BaseDePrueba, sql: string, parametros: unknown[] = []): Promise<string> {
  const { rows } = await db.query<{ id: string }>(sql, parametros);
  return rows[0].id;
}

/**
 * Crea un hotel aceptado (sin publicar) en Ciudad de Panamá, con un usuario de WOPA,
 * un plan con política de cancelación y un tipo de habitación.
 */
export async function crearHotelDePrueba(db: BaseDePrueba, slug = "hotel-prueba") {
  const usuarioWopa = await insertar(
    db,
    "INSERT INTO identidad.usuarios (correo, nombre) VALUES ($1, 'Operaciones WOPA') RETURNING id",
    [`ops+${slug}@wopa.test`],
  );
  const organizacion = await insertar(
    db,
    "INSERT INTO identidad.organizaciones (nombre, tipo) VALUES ($1, 'hotel') RETURNING id",
    [`Org ${slug}`],
  );
  const ciudad = await insertar(db, "SELECT ciudad_id AS id FROM geo.ciudad_traducciones WHERE slug = 'ciudad-de-panama' AND idioma_codigo = 'es'");
  const hotel = await insertar(
    db,
    `INSERT INTO catalogo.hoteles
       (organizacion_id, ciudad_id, slug, nombre, moneda_codigo, zona_horaria, latitud, longitud, direccion, aceptado_por, aceptado_en)
     VALUES ($1, $2, $3, 'Hotel de Prueba', 'USD', 'America/Panama', 8.95, -79.53, 'Calle 1', $4, now())
     RETURNING id`,
    [organizacion, ciudad, slug, usuarioWopa],
  );
  const politica = await insertar(
    db,
    "INSERT INTO tarifas.politicas_cancelacion (hotel_id, codigo) VALUES ($1, 'flexible') RETURNING id",
    [hotel],
  );
  const plan = await insertar(
    db,
    "INSERT INTO tarifas.planes_tarifa (hotel_id, politica_cancelacion_id, codigo) VALUES ($1, $2, 'base') RETURNING id",
    [hotel, politica],
  );
  const habitacion = await insertar(
    db,
    "INSERT INTO catalogo.tipos_habitacion (hotel_id, codigo, capacidad_maxima) VALUES ($1, 'doble', 2) RETURNING id",
    [hotel],
  );
  return { usuarioWopa, organizacion, ciudad, hotel, politica, plan, habitacion };
}
