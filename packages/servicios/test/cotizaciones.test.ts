import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { crearBaseMigrada, type BaseDePrueba } from "@wopa/db/pruebas";
import { aceptarHotel, cargarTarifaNeta, crearHotel, crearTipoHabitacion } from "../src/catalogo.ts";
import { crearCotizacion, obtenerCotizacion } from "../src/experiencias.ts";
import { fecha, idCiudad, idPlanBase, sesionWopa } from "./ayudantes.ts";

let db: BaseDePrueba;
let slug: string;
before(async () => {
  db = await crearBaseMigrada();
  const wopa = await sesionWopa(db);
  const ciudad = await idCiudad(db, "boquete");
  const hotel = await crearHotel(wopa, { nombre: "Cabañas del Volcán", ciudadId: ciudad, monedaCodigo: "USD", direccion: "Boquete", latitud: 8.78, longitud: -82.44, modoReserva: "solicitud" }, db);
  const habitacion = await crearTipoHabitacion(wopa, { hotelId: hotel.hotelId, codigo: "cabana", capacidadMaxima: 4, nombre: { es: "Cabaña" } }, db);
  await cargarTarifaNeta(wopa, { hotelId: hotel.hotelId, planTarifaId: await idPlanBase(db, hotel.hotelId), tipoHabitacionId: habitacion, desde: fecha(1), hasta: fecha(60), ocupacion: 4, netoCentavos: 10_000n }, db);
  await aceptarHotel(wopa, { hotelId: hotel.hotelId, margen: { tipo: "porcentaje", porcentajeBp: 3000 }, desde: fecha(0) }, db);
  await db.query(`INSERT INTO experiencias.experiencias (ciudad_id, codigo, categoria, precio_centavos, moneda_codigo, unidad_precio)
    VALUES ($1, 'cafe', 'gastronomia', 2500, 'USD', 'persona'), ($1, 'volcan', 'aventura', NULL, 'USD', 'grupo')`, [ciudad]);
  await db.query(`INSERT INTO experiencias.experiencia_traducciones (experiencia_id, idioma_codigo, nombre, descripcion)
    SELECT id, 'es', CASE codigo WHEN 'cafe' THEN 'Tour de café' ELSE 'Volcán Barú' END, 'Descripción' FROM experiencias.experiencias`);
  slug = hotel.slug;
});
after(async () => {
  await db.close();
});

test("cotiza hospedaje + tour por persona con total completo", async () => {
  const cotizacion = await crearCotizacion({ idioma: "es", nombre: "Ana", correo: "ana@example.test", telefono: "+50760000000", personas: 3, hotelSlug: slug, experienciaCodigo: "cafe", entrada: fecha(10), salida: fecha(12) }, db);
  assert.match(cotizacion.codigo, /^WP-C-[A-F0-9]{16}$/);
  assert.deepEqual(cotizacion.lineas.map((l) => l.montoCentavos), [26_000n, 7_500n]); // 2 noches × 130 y 3 × 25
  assert.equal(cotizacion.totalCentavos, 33_500n);
  assert.equal(cotizacion.parcial, false);
  const guardada = await obtenerCotizacion(cotizacion.codigo, db);
  assert.equal(guardada?.totalCentavos, 33_500n);
});

test("un tour sin precio deja la cotización parcial", async () => {
  const cotizacion = await crearCotizacion({ idioma: "en", nombre: "Luis", correo: "luis@example.test", telefono: "+50760000000", personas: 2, experienciaCodigo: "volcan" }, db);
  assert.equal(cotizacion.parcial, true);
  assert.equal(cotizacion.totalCentavos, 0n);
});

test("pide al menos un hotel o un tour y no acepta códigos inventados", async () => {
  await assert.rejects(crearCotizacion({ idioma: "es", nombre: "Eva", correo: "eva@example.test", telefono: "1", personas: 2 }, db), { codigo: "COTIZACION_VACIA" });
  assert.equal(await obtenerCotizacion("WP-C-0000", db), null);
});
