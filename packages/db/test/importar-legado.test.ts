import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import { calcularNoche } from "@wopa/dominio/tarifas";
import { crearAdministradorWopa, importarLegado, migrar, netaDesdePrecioPublico } from "../src/index.ts";
import { crearBaseVacia, type BaseDePrueba } from "./ayudantes.ts";

const require = createRequire(import.meta.url);
let db: BaseDePrueba;

before(async () => {
  db = await crearBaseVacia();
  // Crea las tablas heredadas con su catálogo inicial, igual que la web actual en producción.
  const urlAnterior = process.env.DATABASE_URL;
  process.env.DATABASE_URL = db.url;
  const legado = require("../../../server/db/conexion.js");
  await legado.inicializarBaseDatos();
  await legado.cerrar();
  process.env.DATABASE_URL = urlAnterior;

  await db.query(`
    INSERT INTO solicitudes_reserva (codigo, tipo_id, nombre, correo, telefono, numero_personas, fecha_entrada, fecha_salida,
      noches, tarifa_noche_usd, subtotal_usd, anticipo_usd, estado)
    VALUES ('WOPA-R-0123456789ABCDEF', 1, 'Ana Pérez', 'ana@example.test', '+5076000000', 2, '2026-11-10', '2026-11-12', 2, 90, 180, 45, 'confirmada')`);
  await db.query(`
    INSERT INTO mensajes_contacto (codigo, nombre, correo, asunto, mensaje, estado)
    VALUES ('WOPA-M-0001', 'Luis', 'luis@example.test', 'Consulta', '¿Tienen traslado al aeropuerto?', 'nuevo')`);
  await db.query(`
    INSERT INTO movimientos_financieros (tipo, categoria, descripcion, monto_usd, solicitud_reserva_id, creado_por)
    VALUES ('ingreso', 'anticipo', 'Anticipo Ana', 45, 1, 'admin'), ('egreso', 'publicidad', 'Anuncios', 20, NULL, 'admin')`);
  await db.query(`
    INSERT INTO actividad_sitio (tipo_evento, entidad, codigo_entidad, detalle, realizado_por)
    VALUES ('reserva_solicitada', 'reserva', 'WOPA-R-0123456789ABCDEF', 'Nueva solicitud', 'web')`);

  await migrar(db);
  await crearAdministradorWopa(db, { correo: "ops@wopa.test", nombre: "Operaciones", clave: "clave de prueba segura" });
});

after(async () => {
  await db.close();
});

test("la neta derivada reproduce el precio al público heredado con 30 % de margen", () => {
  for (const precio of [50, 60, 75, 80, 90, 110, 160, 200, 240, 280]) {
    const centavos = BigInt(precio * 100);
    const neta = netaDesdePrecioPublico(centavos);
    const noche = calcularNoche(neta, { tipo: "porcentaje", porcentajeBp: 3000 }, 100n);
    assert.equal(noche.ventaCentavos, centavos, `precio ${precio}`);
  }
});

test("importa todo y una segunda ejecución no duplica nada", async () => {
  const primera = await importarLegado(db, { correoAdmin: "ops@wopa.test", hoy: "2026-10-15" });
  assert.equal(primera.hoteles, 8);
  assert.equal(primera.experiencias, 6);
  assert.equal(primera.reservas, 1);
  assert.equal(primera.tickets, 1);
  assert.equal(primera.operacionesContables, 2);
  assert.equal(primera.eventosAuditoria, 1);

  const segunda = await importarLegado(db, { correoAdmin: "ops@wopa.test", hoy: "2026-10-15" });
  assert.deepEqual(
    [segunda.hoteles, segunda.experiencias, segunda.reservas, segunda.cotizaciones, segunda.tickets, segunda.operacionesContables, segunda.eventosAuditoria],
    [0, 0, 0, 0, 0, 0, 0],
  );
});

test("los hoteles quedan publicados en Cartagena, en modo solicitud y con margen del 30 %", async () => {
  const { rows } = await db.query<{ estado: string; modo_reserva: string; ciudad: string; margenes: number; precios: number; servicios: number }>(`
    SELECT h.estado, h.modo_reserva, ct.slug AS ciudad,
      (SELECT count(*)::int FROM tarifas.reglas_margen r WHERE r.hotel_id = h.id AND r.porcentaje_bp = 3000) AS margenes,
      (SELECT count(*)::int FROM tarifas.precios_dia p WHERE p.hotel_id = h.id) AS precios,
      (SELECT count(*)::int FROM catalogo.hotel_servicios s WHERE s.hotel_id = h.id) AS servicios
    FROM catalogo.hoteles h JOIN geo.ciudad_traducciones ct ON ct.ciudad_id = h.ciudad_id AND ct.idioma_codigo = 'es'
    WHERE h.slug = 'hotel-regatta'`);
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { estado: rows[0].estado, modo: rows[0].modo_reserva, ciudad: rows[0].ciudad, margenes: rows[0].margenes },
    { estado: "publicado", modo: "solicitud", ciudad: "cartagena", margenes: 1 },
  );
  assert.equal(rows[0].precios, 365 * 4); // ocupaciones 1 a 4 durante un año
  assert.ok(rows[0].servicios >= 4);

  // Regatta: 160 USD para 2 personas → la neta + 30 % vuelve a dar 160.
  const neta = await db.query<{ monto: string }>(`
    SELECT p.monto_neto_centavos AS monto FROM tarifas.precios_dia p JOIN catalogo.hoteles h ON h.id = p.hotel_id
    WHERE h.slug = 'hotel-regatta' AND p.ocupacion = 2 AND p.fecha = '2026-10-15'`);
  const venta = calcularNoche(BigInt(neta.rows[0].monto), { tipo: "porcentaje", porcentajeBp: 3000 }, 100n).ventaCentavos;
  assert.equal(venta, 16_000n);
});

test("la reserva conserva su código, estado y precio por noche separado en neta y margen", async () => {
  const { rows } = await db.query<{ estado: string; saldo: string; noches: number; venta: string }>(`
    SELECT r.estado, r.saldo_centavos AS saldo,
      (SELECT count(*)::int FROM reservas.reserva_noches n JOIN reservas.reserva_lineas l ON l.id = n.reserva_linea_id WHERE l.reserva_id = r.id) AS noches,
      (SELECT sum(n.monto_venta_centavos) FROM reservas.reserva_noches n JOIN reservas.reserva_lineas l ON l.id = n.reserva_linea_id WHERE l.reserva_id = r.id) AS venta
    FROM reservas.reservas r WHERE r.codigo = 'WOPA-R-0123456789ABCDEF'`);
  assert.deepEqual(
    { estado: rows[0].estado, saldo: Number(rows[0].saldo), noches: rows[0].noches, venta: Number(rows[0].venta) },
    { estado: "confirmada", saldo: 13_500, noches: 2, venta: 18_000 },
  );
});

test("los movimientos pasan a asientos que cuadran y el mensaje pasa a ticket", async () => {
  const cuadre = await db.query<{ total: string }>("SELECT sum(monto_centavos) AS total FROM pagos.asientos");
  assert.equal(Number(cuadre.rows[0].total), 0);
  const ticket = await db.query<{ estado: string; origen: string }>("SELECT estado, origen FROM soporte.tickets");
  assert.deepEqual(ticket.rows, [{ estado: "abierto", origen: "legado" }]);
});
