const { Pool, neonConfig } = require("@neondatabase/serverless");
const WebSocket = require("ws");
const path = require("path");
const fs = require("fs");

const columnasNuevas = [
  ["solicitudes_reserva", "nota_admin", "TEXT"],
  ["solicitudes_reserva", "monto_penalizacion_usd", "DECIMAL(10, 2) NOT NULL DEFAULT 0"],
  ["solicitudes_reserva", "fecha_cancelacion", "DATETIME"],
  ["solicitudes_reserva", "motivo_cancelacion", "TEXT"],
  ["solicitudes_cotizacion", "nota_admin", "TEXT"],
  ["solicitudes_cotizacion", "subtotal_experiencias_usd", "DECIMAL(10, 2)"],
  ["solicitudes_cotizacion", "unidad_experiencia", "TEXT"],
  ["solicitudes_cotizacion", "total_estimado_usd", "DECIMAL(10, 2)"],
  ["solicitudes_cotizacion", "cotizacion_completa", "INTEGER NOT NULL DEFAULT 0"],
  ["experiencias", "unidad_precio", "TEXT NOT NULL DEFAULT 'persona'"],
  ["mensajes_contacto", "nota_admin", "TEXT"],
];

const tiposIniciales = [
  ["Hotel La Casona de Getsemaní", "Hotel boutique en el corazón del Getsemaní", "WiFi, Aire acondicionado, Desayuno incluido, Minibar", "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80", 60, 90],
  ["Hotel Marina Suites by GEH Suites", "Suites modernas con vistas al mar", "WiFi, TV cable, Piscina, Gimnasio, Restaurante", "https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=1200&q=80", 60, 280],
  ["Hotel Dorado Centro Histórico", "Hotel en el corazón del centro histórico", "WiFi, Aire acondicionado, Concierge 24/7, Parqueo", "https://images.unsplash.com/photo-1523906834658-6e24ef2386f9?auto=format&fit=crop&w=1200&q=80", 60, 80],
  ["Wala Hotel and Beach Club Bocagrande", "Resort de lujo frente al mar en Bocagrande", "WiFi, Piscina, Playa privada, Spa, Restaurante gourmet", "https://images.unsplash.com/photo-1493558103817-58b2924b5713?auto=format&fit=crop&w=1200&q=80", 120, 200],
  ["Mintaka Hotel and Lounge", "Opción económica y acogedora", "WiFi, Aire acondicionado, Recepción 24/7, Terraza", "https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1200&q=80", 50, 80],
  ["Hotel Aixo Suites by GEH Suites", "Apartamentos amueblados con servicios hoteleros", "WiFi, Cocina, Aire acondicionado, Parqueo, Lavandería", "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80", 75, 110],
  ["Hotel Atlantic Luc", "Hotel frente al mar con servicios de lujo", "WiFi, Piscina, Playa privada, Restaurante, Gimnasio", "https://images.unsplash.com/photo-1500530855721-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80", 110, 210],
  ["Hotel Regatta", "Experiencia premium frente al Caribe", "WiFi, Piscina infinita, Spa de lujo, Restaurante 5 estrellas, Concierge", "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80", 160, 240],
];

const usarPostgres = Boolean(process.env.DATABASE_URL);
const faltaUrlEnVercel = Boolean(process.env.VERCEL && !usarPostgres);
let sqlite;
let pool;
let inicializacion;
let colaSQLite = Promise.resolve();

if (usarPostgres) {
  neonConfig.webSocketConstructor = WebSocket;
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, idleTimeoutMillis: 10000 });
  pool.on("error", (error) => console.error("Error inesperado en la conexión PostgreSQL."));
} else if (!faltaUrlEnVercel) {
  const Database = require("better-sqlite3");
  const dbPath = process.env.DB_PATH || path.join(__dirname, "hotel.db");
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");
}

function adaptarPostgres(sql) {
  let parametro = 0;
  return sql.replace(/\?/g, () => `$${++parametro}`);
}

function crearAdaptador(ejecutor, postgres = usarPostgres) {
  const ejecutar = async (sql, parametros = []) => {
    if (postgres) {
      const consulta = adaptarPostgres(sql);
      const resultado = await ejecutor.query(consulta, parametros);
      const filas = resultado.rows.map((fila) => {
        for (const campo of resultado.fields || []) {
          if ([20, 700, 701, 1700].includes(campo.dataTypeID) && typeof fila[campo.name] === "string") {
            const numero = Number(fila[campo.name]);
            if (Number.isFinite(numero)) fila[campo.name] = numero;
          }
        }
        return fila;
      });
      return { rows: filas, rowCount: resultado.rowCount ?? resultado.affectedRows ?? filas.length };
    }
    const statement = ejecutor.prepare(sql);
    const esLectura = /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql);
    if (esLectura) return { rows: statement.all(...parametros), rowCount: 0 };
    const resultado = statement.run(...parametros);
    return { rows: [], rowCount: resultado.changes, lastInsertRowid: resultado.lastInsertRowid };
  };

  return {
    prepare(sql) {
      return {
        all: async (...parametros) => (await ejecutar(sql, parametros)).rows,
        get: async (...parametros) => (await ejecutar(sql, parametros)).rows[0],
        run: async (...parametros) => {
          if (postgres && /^\s*INSERT\b/i.test(sql) && !/\bRETURNING\b/i.test(sql)) {
            const resultado = await ejecutar(`${sql.trim().replace(/;$/, "")} RETURNING id`, parametros);
            return { changes: resultado.rowCount, lastInsertRowid: resultado.rows[0]?.id };
          }
          const resultado = await ejecutar(sql, parametros);
          return { changes: resultado.rowCount, lastInsertRowid: resultado.lastInsertRowid ?? resultado.rows[0]?.id };
        },
      };
    },
    async transaction(callback) {
      if (postgres) {
        const client = await ejecutor.connect();
        try {
          await client.query("BEGIN");
          const resultado = await callback(crearAdaptador(client, true));
          await client.query("COMMIT");
          return resultado;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }

      let liberar;
      const anterior = colaSQLite;
      colaSQLite = new Promise((resolve) => { liberar = resolve; });
      await anterior;
      try {
        ejecutor.exec("BEGIN IMMEDIATE");
        const resultado = await callback(crearAdaptador(ejecutor, false));
        ejecutor.exec("COMMIT");
        return resultado;
      } catch (error) {
        ejecutor.exec("ROLLBACK");
        throw error;
      } finally {
        liberar();
      }
    },
  };
}

const db = crearAdaptador(usarPostgres ? pool : sqlite);

function adaptarEsquemaPostgres(schema) {
  return schema
    .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, "SERIAL PRIMARY KEY")
    .replace(/\bDATETIME\b/gi, "TIMESTAMP")
    .replace(/DEFAULT \(date\('now'\)\)/gi, "DEFAULT CURRENT_DATE");
}

async function inicializarSQLite() {
  const schema = fs.readFileSync(path.join(__dirname, "esquema.sql"), "utf8");
  for (const sentencia of schema.split(";").map((item) => item.trim()).filter(Boolean)) sqlite.exec(sentencia);

  for (const [tabla, columna, definicion] of columnasNuevas) {
    const existentes = sqlite.prepare(`PRAGMA table_info(${tabla})`).all();
    if (!existentes.some((item) => item.name === columna)) sqlite.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
  }

  sqlite.prepare("UPDATE hoteles SET correo = ? WHERE slug = 'wopa-travel-cartagena'").run("wondersofpty@gmail.com");
  const cantidad = sqlite.prepare("SELECT COUNT(*) AS count FROM tipos_habitacion").get().count;
  if (cantidad === 0) {
    const seed = fs.readFileSync(path.join(__dirname, "datos_iniciales.sql"), "utf8");
    sqlite.transaction(() => {
      for (const sentencia of seed.split(";").map((item) => item.trim()).filter(Boolean)) sqlite.exec(sentencia);
    })();
  }
  sqlite.exec(fs.readFileSync(path.join(__dirname, "experiencias_iniciales.sql"), "utf8"));
}

async function inicializarPostgres(pgPool = pool) {
  const schemaOriginal = fs.readFileSync(path.join(__dirname, "esquema.sql"), "utf8");
  const schema = adaptarEsquemaPostgres(schemaOriginal);
  for (const sentencia of schema.split(";").map((item) => item.trim()).filter(Boolean)) await pgPool.query(sentencia);

  for (const [tabla, columna, definicion] of columnasNuevas) {
    const definicionPostgres = definicion.replace(/\bDATETIME\b/gi, "TIMESTAMP");
    await pgPool.query(`ALTER TABLE ${tabla} ADD COLUMN IF NOT EXISTS ${columna} ${definicionPostgres}`);
  }

  await pgPool.query(`
    INSERT INTO hoteles (nombre, slug, descripcion, direccion, ciudad, pais, rnt, telefono, correo)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (slug) DO UPDATE SET correo = EXCLUDED.correo
  `, ["WOPA Travel - Hoteles aliados Cartagena", "wopa-travel-cartagena", "Agencia de viajes WOPA Travel ofrece opciones de alojamiento en Cartagena con hoteles aliados y tarifas en USD por noche", "Cartagena de Indias", "Cartagena", "Colombia", "RNT-WOPA", "50762869154", "wondersofpty@gmail.com"]);
  const hotel = (await pgPool.query("SELECT id FROM hoteles WHERE slug = $1", ["wopa-travel-cartagena"])).rows[0];

  for (const [nombre, descripcion, servicios, imagen, precioDos, precioCuatro] of tiposIniciales) {
    await pgPool.query(`
      INSERT INTO tipos_habitacion (hotel_id, nombre, descripcion, capacidad_minima, capacidad_maxima, servicios, imagen_url)
      VALUES ($1, $2, $3, 1, 4, $4, $5)
      ON CONFLICT (hotel_id, nombre) DO NOTHING
    `, [hotel.id, nombre, descripcion, servicios, imagen]);
    const tipo = (await pgPool.query("SELECT id FROM tipos_habitacion WHERE hotel_id = $1 AND nombre = $2", [hotel.id, nombre])).rows[0];
    for (const [capacidad, precio] of [[2, precioDos], [4, precioCuatro]]) {
      await pgPool.query(`
        INSERT INTO tarifas (tipo_id, capacidad_personas, precio_usd, temporada)
        VALUES ($1, $2, $3, 'baja')
        ON CONFLICT (tipo_id, capacidad_personas, temporada) DO UPDATE SET precio_usd = EXCLUDED.precio_usd
      `, [tipo.id, capacidad, precio]);
    }
  }

  const experiencias = fs.readFileSync(path.join(__dirname, "experiencias_iniciales.sql"), "utf8");
  for (const sentencia of experiencias.split(";").map((item) => item.trim()).filter(Boolean)) await pgPool.query(sentencia);
}

db.inicializarBaseDatos = () => {
  if (process.env.VERCEL && !process.env.DATABASE_URL) {
    return Promise.reject(new Error("DATABASE_URL es obligatorio en Vercel."));
  }
  if (!inicializacion) {
    inicializacion = (usarPostgres ? inicializarPostgres() : inicializarSQLite()).catch((error) => {
      inicializacion = null;
      throw error;
    });
  }
  return inicializacion;
};
db.esPostgres = usarPostgres;
db.inicializarPostgres = inicializarPostgres;
db.crearAdaptador = crearAdaptador;
db.adaptarPostgres = adaptarPostgres;
db.cerrar = async () => {
  if (usarPostgres) await pool.end();
  else if (sqlite) sqlite.close();
};

module.exports = db;
