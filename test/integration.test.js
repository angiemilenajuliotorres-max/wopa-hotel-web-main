const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");

const temporal = fs.mkdtempSync(path.join(os.tmpdir(), "wopa-local-test-"));
process.env.DB_PATH = path.join(temporal, "hotel-test.sqlite");
process.env.DATABASE_URL = "";
process.env.VERCEL = "";
process.env.ADMIN_USER = "wopa-test-admin";
process.env.ADMIN_PASSWORD = crypto.randomBytes(24).toString("base64url");
process.env.ADMIN_SESSION_SECRET = crypto.randomBytes(48).toString("base64url");

const app = require("../server/app");
const db = require("../server/db/conexion");
const { PGlite } = require("@electric-sql/pglite");
let server;
let baseUrl;

before(async () => {
  await db.inicializarBaseDatos();
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.cerrar();
  fs.rmSync(temporal, { recursive: true, force: true });
});

test("API local conserva catálogo, solicitudes y autenticación administrativa", async () => {
  const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
  assert.equal(health.ok, true);

  const rooms = await fetch(`${baseUrl}/api/habitaciones`).then((response) => response.json());
  assert.equal(rooms.data.length, 8);
  assert.equal(rooms.data[0].tarifas.length, 2);
  const roomDetail = await fetch(`${baseUrl}/api/habitaciones/${rooms.data[0].id}`).then((response) => response.json());
  assert.equal(roomDetail.data.tarifas.length, 2);

  const experiences = await fetch(`${baseUrl}/api/experiencias`).then((response) => response.json());
  assert.equal(experiences.data.length, 6);

  const start = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const bookingResponse = await fetch(`${baseUrl}/api/reservas`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      nombre: "Prueba de integración",
      correo: "local@example.test",
      telefono: "00000000",
      tipoId: rooms.data[0].id,
      numeroPersonas: 2,
      fechaEntrada: start,
      fechaSalida: end,
    }),
  });
  const booking = await bookingResponse.json();
  assert.equal(bookingResponse.status, 201);
  assert.equal(booking.estado, "pendiente_confirmacion");

  const loginResponse = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
    body: JSON.stringify({ usuario: process.env.ADMIN_USER, clave: process.env.ADMIN_PASSWORD }),
  });
  assert.equal(loginResponse.status, 200);
  const cookieHeader = loginResponse.headers.get("set-cookie");
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /SameSite=Strict/);
  assert.match(cookieHeader, /Secure/);
  const cookie = cookieHeader.split(";")[0];

  const adminHeaders = { cookie };
  const adminCatalog = await fetch(`${baseUrl}/api/admin/catalogo`, { headers: adminHeaders }).then((response) => response.json());
  assert.equal(adminCatalog.data.hoteles.length, 8);
  assert.equal(adminCatalog.data.hoteles[0].tarifas.length, 2);

  const summary = await fetch(`${baseUrl}/api/admin/resumen`, { headers: adminHeaders }).then((response) => response.json());
  assert.equal(summary.ok, true);

  const adminBookings = await fetch(`${baseUrl}/api/admin/reservas`, { headers: adminHeaders }).then((response) => response.json());
  const savedBooking = adminBookings.data.find((item) => item.codigo === booking.codigo);
  assert.ok(savedBooking);

  const payment = await fetch(`${baseUrl}/api/admin/reservas/${savedBooking.id}/pagos`, {
    method: "POST",
    headers: { ...adminHeaders, "content-type": "application/json" },
    body: JSON.stringify({ montoUsd: 10 }),
  });
  assert.equal(payment.status, 201);

  const canceled = await fetch(`${baseUrl}/api/admin/reservas/${savedBooking.id}`, {
    method: "PATCH",
    headers: { ...adminHeaders, "content-type": "application/json" },
    body: JSON.stringify({ estado: "cancelada", motivoCancelacion: "Prueba local" }),
  });
  const cancellation = await canceled.json();
  assert.equal(canceled.status, 200);
  assert.equal(cancellation.penalizacionUsd, 10);
});

test("schema y seed PostgreSQL son válidos e idempotentes", async () => {
  const postgres = new PGlite();
  const executor = {
    query: (sql, parameters) => postgres.query(sql, parameters),
    async connect() {
      return {
        query: (sql, parameters) => postgres.query(sql, parameters),
        release() {},
      };
    },
  };
  try {
    await db.inicializarPostgres(executor);
    await db.inicializarPostgres(executor);
    const counts = await postgres.query(`
      SELECT
        (SELECT COUNT(*)::integer FROM tipos_habitacion) AS hoteles,
        (SELECT COUNT(*)::integer FROM tarifas) AS tarifas,
        (SELECT COUNT(*)::integer FROM experiencias) AS experiencias
    `);
    assert.deepEqual(counts.rows[0], { hoteles: 8, tarifas: 16, experiencias: 6 });

    const postgresAdapter = db.crearAdaptador(executor, true);
    const count = await postgresAdapter.prepare("SELECT COUNT(*) AS count FROM tipos_habitacion WHERE id = ?").get(1);
    assert.equal(count.count, 1);
    assert.equal(db.adaptarPostgres("SELECT * FROM tabla WHERE id = ? AND nombre = ?"), "SELECT * FROM tabla WHERE id = $1 AND nombre = $2");

    const inserted = await postgresAdapter.transaction((tx) => tx.prepare(`
      INSERT INTO mensajes_contacto (codigo, nombre, correo, asunto, mensaje)
      VALUES (?, ?, ?, ?, ?)
    `).run("WOPA-M-TEST", "Prueba", "pg@example.test", "Asunto", "Mensaje de prueba."));
    assert.ok(inserted.lastInsertRowid > 0);
    const messages = await postgresAdapter.prepare("SELECT COUNT(*) AS count FROM mensajes_contacto").get();
    assert.equal(messages.count, 1);
  } finally {
    await postgres.close();
  }
});