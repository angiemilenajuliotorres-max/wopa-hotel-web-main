const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { crearBaseDePrueba } = require("./postgres-de-prueba");

// Vacía a propósito: dotenv no la sobrescribe, así un .env local nunca apunta las pruebas a Neon.
process.env.DATABASE_URL = "";
process.env.VERCEL = "";
process.env.ADMIN_USER = "wopa-test-admin";
process.env.ADMIN_PASSWORD = crypto.randomBytes(24).toString("base64url");
process.env.ADMIN_SESSION_SECRET = crypto.randomBytes(48).toString("base64url");

const app = require("../server/app");
const db = require("../server/db/conexion");
let base;
let server;
let baseUrl;

before(async () => {
  base = await crearBaseDePrueba();
  process.env.DATABASE_URL = base.url;
  await db.inicializarBaseDatos();
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.cerrar();
  if (base) await base.eliminar();
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

test("fase 0: rutas de prueba retiradas, CORS cerrado, CSP activa y disponibilidad desactivada", async () => {
  for (const ruta of ["/api/admin-test", "/api/no-existe"]) {
    const response = await fetch(`${baseUrl}${ruta}`);
    assert.equal(response.status, 404, ruta);
    assert.match(response.headers.get("content-type"), /application\/json/, ruta);
  }

  const directo = await fetch(`${baseUrl}/api/admin/test-directo`);
  assert.equal(directo.status, 401);

  const crossOrigin = await fetch(`${baseUrl}/api/health`, { headers: { origin: "https://sitio-ajeno.example" } });
  assert.equal(crossOrigin.status, 200);
  assert.equal(crossOrigin.headers.get("access-control-allow-origin"), null);

  const csp = crossOrigin.headers.get("content-security-policy");
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);

  const disponibilidad = await fetch(`${baseUrl}/api/habitaciones/disponibilidad`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fechaEntrada: "2030-01-01", fechaSalida: "2030-01-03", numeroPersonas: 2 }),
  });
  assert.equal(disponibilidad.status, 410);

  const estatico = await fetch(`${baseUrl}/`);
  assert.equal(estatico.status, 200);
  assert.equal(estatico.headers.get("ratelimit-policy"), null);
});

test("vercel.json aplica la misma CSP a los archivos estáticos", () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  const cabeceras = vercel.headers.find((regla) => regla.source === "/(.*)").headers;
  const csp = cabeceras.find((cabecera) => cabecera.key === "Content-Security-Policy").value;
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
});

test("la inicialización PostgreSQL es idempotente y las transacciones funcionan", async () => {
  await db.inicializarPostgres();
  const counts = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM tipos_habitacion) AS hoteles,
      (SELECT COUNT(*) FROM tarifas) AS tarifas,
      (SELECT COUNT(*) FROM experiencias) AS experiencias
  `).get();
  assert.deepEqual(counts, { hoteles: 8, tarifas: 16, experiencias: 6 });

  const count = await db.prepare("SELECT COUNT(*) AS count FROM tipos_habitacion WHERE id = ?").get(1);
  assert.equal(count.count, 1);
  assert.equal(db.adaptarPostgres("SELECT * FROM tabla WHERE id = ? AND nombre = ?"), "SELECT * FROM tabla WHERE id = $1 AND nombre = $2");

  const antes = (await db.prepare("SELECT COUNT(*) AS count FROM mensajes_contacto").get()).count;
  const inserted = await db.transaction((tx) => tx.prepare(`
    INSERT INTO mensajes_contacto (codigo, nombre, correo, asunto, mensaje)
    VALUES (?, ?, ?, ?, ?)
  `).run("WOPA-M-TEST", "Prueba", "pg@example.test", "Asunto", "Mensaje de prueba."));
  assert.ok(inserted.lastInsertRowid > 0);
  const despues = (await db.prepare("SELECT COUNT(*) AS count FROM mensajes_contacto").get()).count;
  assert.equal(despues, antes + 1);

  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.prepare("INSERT INTO mensajes_contacto (codigo, nombre, correo, asunto, mensaje) VALUES (?, ?, ?, ?, ?)")
        .run("WOPA-M-ROLLBACK", "Prueba", "pg@example.test", "Asunto", "No debe quedar.");
      throw new Error("forzar rollback");
    }),
    /forzar rollback/,
  );
  const tras = (await db.prepare("SELECT COUNT(*) AS count FROM mensajes_contacto WHERE codigo = ?").get("WOPA-M-ROLLBACK")).count;
  assert.equal(tras, 0);
});