const crypto = require("node:crypto");
const { Client } = require("pg");

/*
 * Crea una base de datos temporal en el Postgres de pruebas y la elimina al terminar.
 * Por defecto usa el Postgres de Docker (docker compose up -d).
 */
const URL_SERVIDOR = process.env.PRUEBAS_DATABASE_URL || "postgres://wopa:wopa_local@localhost:5433/wopa";

async function conectar(url) {
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (error) {
    throw new Error(
      `No hay Postgres de pruebas en ${new URL(url).host}. Levántalo con \`docker compose up -d\` ` +
        `o define PRUEBAS_DATABASE_URL. (${error.message})`,
    );
  }
  return cliente;
}

async function crearBaseDePrueba() {
  const nombre = `wopa_prueba_${crypto.randomBytes(6).toString("hex")}`;
  const admin = await conectar(URL_SERVIDOR);
  try {
    await admin.query(`CREATE DATABASE ${nombre}`);
  } finally {
    await admin.end();
  }
  const url = new URL(URL_SERVIDOR);
  url.pathname = `/${nombre}`;

  return {
    url: url.toString(),
    async eliminar() {
      const cliente = await conectar(URL_SERVIDOR);
      try {
        await cliente.query(`DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`);
      } finally {
        await cliente.end();
      }
    },
  };
}

module.exports = { crearBaseDePrueba };
