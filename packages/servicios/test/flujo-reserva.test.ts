import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { crearBaseMigrada, type BaseDePrueba } from "@wopa/db/pruebas";
import { buscarDestinos, buscarHoteles, fichaHotel } from "../src/busqueda.ts";
import { aceptarHotel, ajustarMargen, cargarCupos, cargarTarifaNeta, crearHotel, crearTipoHabitacion, historialMargenes, listarHotelesAdmin } from "../src/catalogo.ts";
import type { SesionActiva } from "../src/identidad.ts";
import { aceptarSolicitud, cancelarPorViajero, consultarReserva, crearReserva, expirarRetenciones, rechazarSolicitud } from "../src/reservas.ts";
import { fecha, idCiudad, idPlanBase, sesionWopa } from "./ayudantes.ts";

let db: BaseDePrueba;
let wopa: SesionActiva;
let hotel: { hotelId: string; slug: string; plan: string; doble: string };
const titular = { nombre: "Ana Pérez", correo: "ana@example.test", telefono: "+507 6000-0000", paisCodigo: "PA" };
const criterios = (entrada: number, salida: number, huespedes = 2) => ({ entrada: fecha(entrada), salida: fecha(salida), huespedes, idioma: "es" as const });

before(async () => {
  db = await crearBaseMigrada();
  wopa = await sesionWopa(db);
  const ciudad = await idCiudad(db, "ciudad-de-panama");
  const creado = await crearHotel(wopa, { nombre: "Hotel Casco Viejo", ciudadId: ciudad, monedaCodigo: "USD", direccion: "Calle 3, Casco Antiguo", latitud: 8.952, longitud: -79.535, categoria: 4 }, db);
  const doble = await crearTipoHabitacion(wopa, { hotelId: creado.hotelId, codigo: "Doble Superior", capacidadMaxima: 2, nombre: { es: "Doble superior", en: "Superior double" } }, db);
  const plan = await idPlanBase(db, creado.hotelId);
  await cargarTarifaNeta(wopa, { hotelId: creado.hotelId, planTarifaId: plan, tipoHabitacionId: doble, desde: fecha(1), hasta: fecha(90), ocupacion: 2, netoCentavos: 10_000n }, db);
  await cargarCupos(wopa, { hotelId: creado.hotelId, tipoHabitacionId: doble, desde: fecha(1), hasta: fecha(90), cupoTotal: 1 }, db);
  hotel = { hotelId: creado.hotelId, slug: creado.slug, plan, doble };
});
after(async () => {
  await db.close();
});

describe("alta y aceptación del hotel por WOPA", () => {
  test("un hotel sin aceptar no aparece en la búsqueda", async () => {
    const resultado = await buscarHoteles({ tipo: "ciudad", slug: "ciudad-de-panama" }, criterios(10, 12), db);
    assert.equal(resultado.hoteles.length, 0);
    assert.equal((await listarHotelesAdmin(wopa, db))[0].estado, "borrador");
  });

  test("al aceptarlo con margen del 30 % se publica y muestra el precio total", async () => {
    await aceptarHotel(wopa, { hotelId: hotel.hotelId, margen: { tipo: "porcentaje", porcentajeBp: 3000 }, desde: fecha(0) }, db);
    const resultado = await buscarHoteles({ tipo: "ciudad", slug: "ciudad-de-panama" }, criterios(10, 12), db);
    assert.equal(resultado.destino?.nombre, "Ciudad de Panamá");
    assert.equal(resultado.noches, 2);
    const opcion = resultado.hoteles[0].mejorOpcion!;
    assert.equal(opcion.totalCentavos, 26_000n); // 2 noches × (100 + 30 %)
    assert.equal(opcion.anticipoCentavos, 6_500n);
    assert.equal(opcion.saldoCentavos, 19_500n);
    assert.equal(opcion.disponible, true);
    assert.equal(opcion.habitacion, "Doble superior");
  });

  test("el autocompletado encuentra ciudad, país y hotel sin tildes", async () => {
    const destinos = await buscarDestinos("panama", "es", db);
    assert.deepEqual(destinos.filter((d) => d.tipo !== "hotel").map((d) => [d.tipo, d.slug]), [["ciudad", "ciudad-de-panama"], ["pais", "panama"]]);
    assert.equal((await buscarDestinos("casco viejo", "es", db)).find((d) => d.tipo === "hotel")?.slug, hotel.slug);
  });

  test("WOPA ajusta el margen desde una fecha y solo cambian las noches desde ahí", async () => {
    await ajustarMargen(wopa, { hotelId: hotel.hotelId, regla: { tipo: "porcentaje", porcentajeBp: 5000 }, desde: fecha(11), motivo: "Temporada alta" }, db);
    const ficha = await fichaHotel(hotel.slug, "es", criterios(10, 12), db);
    assert.equal(ficha?.opciones[0].totalCentavos, 13_000n + 15_000n);
    const historial = await historialMargenes(wopa, hotel.hotelId, db);
    assert.equal(historial.length, 2);
    assert.equal(historial[1].vigente_hasta, fecha(10)); // la regla anterior se cerró el día antes
    await assert.rejects(
      ajustarMargen(wopa, { hotelId: hotel.hotelId, regla: { tipo: "porcentaje", porcentajeBp: 4000 }, desde: fecha(11), motivo: "Repetido" }, db),
      { codigo: "AJUSTE_SOLAPADO" },
    );
  });

  test("un salto de precio de más del 40 % genera una alerta para WOPA", async () => {
    await cargarTarifaNeta(wopa, { hotelId: hotel.hotelId, planTarifaId: hotel.plan, tipoHabitacionId: hotel.doble, desde: fecha(60), hasta: fecha(61), ocupacion: 2, netoCentavos: 30_000n }, db);
    const alertas = await db.query<{ tipo: string }>("SELECT tipo FROM auditoria.alertas WHERE hotel_id = $1", [hotel.hotelId]);
    assert.deepEqual(alertas.rows.map((a) => a.tipo), ["precio_anomalo"]);
  });
});

describe("reserva con anticipo en línea", () => {
  test("retiene el único cupo; una segunda reserva para esas fechas falla", async () => {
    const reserva = await crearReserva({ hotelSlug: hotel.slug, tipoHabitacionId: hotel.doble, planTarifaId: hotel.plan, ...criterios(20, 22), titular }, db);
    assert.equal(reserva.estado, "retenida");
    assert.match(reserva.codigo, /^WP-/);
    assert.ok(reserva.retenidaHasta && reserva.retenidaHasta.getTime() > Date.now());

    await assert.rejects(
      crearReserva({ hotelSlug: hotel.slug, tipoHabitacionId: hotel.doble, planTarifaId: hotel.plan, ...criterios(21, 23), titular }, db),
      (error: { codigo?: string }) => ["SIN_CUPO", "OPCION_NO_DISPONIBLE"].includes(error.codigo ?? ""),
    );
    const busqueda = await buscarHoteles({ tipo: "ciudad", slug: "ciudad-de-panama" }, criterios(20, 22), db);
    assert.equal(busqueda.hoteles[0].mejorOpcion?.disponible, false);

    // Precio congelado: neta + margen por noche.
    const noches = await db.query<{ neto: string; margen: string }>(
      `SELECT n.monto_neto_centavos AS neto, n.margen_centavos AS margen FROM reservas.reserva_noches n
       JOIN reservas.reserva_lineas l ON l.id = n.reserva_linea_id JOIN reservas.reservas r ON r.id = l.reserva_id WHERE r.codigo = $1`,
      [reserva.codigo],
    );
    assert.deepEqual(noches.rows.map((n) => [Number(n.neto), Number(n.margen)]), [[10_000, 5_000], [10_000, 5_000]]);
  });

  test("si no se paga a tiempo, expira y devuelve el cupo", async () => {
    await db.query("UPDATE reservas.reservas SET retenida_hasta = now() - interval '1 minute' WHERE estado = 'retenida'");
    assert.equal(await expirarRetenciones(db), 1);
    const cupos = await db.query<{ vendido: number }>("SELECT sum(cupo_vendido)::int AS vendido FROM tarifas.cupos_dia WHERE tipo_habitacion_id = $1", [hotel.doble]);
    assert.equal(cupos.rows[0].vendido, 0);
  });

  test("el viajero consulta y cancela su reserva; el cupo vuelve", async () => {
    const reserva = await crearReserva({ hotelSlug: hotel.slug, tipoHabitacionId: hotel.doble, planTarifaId: hotel.plan, ...criterios(30, 31), titular }, db);
    assert.equal(await consultarReserva(reserva.codigo, "otra@example.test", db), null);
    const consulta = await consultarReserva(reserva.codigo.toLowerCase(), "ANA@example.test", db);
    assert.equal(consulta?.estado, "retenida");
    assert.match(consulta!.politica.descripcion, /^Cancelación gratis hasta el/);

    const cancelacion = await cancelarPorViajero({ codigo: reserva.codigo, correo: titular.correo }, db);
    assert.equal(cancelacion.reembolsoCentavos, 0n); // aún no había pagado nada
    const cupos = await db.query<{ vendido: number }>("SELECT sum(cupo_vendido)::int AS vendido FROM tarifas.cupos_dia WHERE tipo_habitacion_id = $1", [hotel.doble]);
    assert.equal(cupos.rows[0].vendido, 0);
  });
});

describe("hotel en modo solicitud", () => {
  let solicitud: { hotelId: string; slug: string; plan: string; habitacion: string };

  before(async () => {
    const ciudad = await idCiudad(db, "boquete");
    const creado = await crearHotel(wopa, { nombre: "Posada del Café", ciudadId: ciudad, monedaCodigo: "USD", direccion: "Alto Boquete", latitud: 8.79, longitud: -82.44, modoReserva: "solicitud" }, db);
    const habitacion = await crearTipoHabitacion(wopa, { hotelId: creado.hotelId, codigo: "cabana", capacidadMaxima: 4, nombre: { es: "Cabaña" } }, db);
    const plan = await idPlanBase(db, creado.hotelId);
    await cargarTarifaNeta(wopa, { hotelId: creado.hotelId, planTarifaId: plan, tipoHabitacionId: habitacion, desde: fecha(1), hasta: fecha(60), ocupacion: 4, netoCentavos: 8_000n }, db);
    await aceptarHotel(wopa, { hotelId: creado.hotelId, margen: { tipo: "monto_fijo", montoCentavos: 2_000n }, desde: fecha(0) }, db);
    solicitud = { hotelId: creado.hotelId, slug: creado.slug, plan, habitacion };
  });

  test("sin cupos cargados aparece disponible bajo solicitud y no cobra hasta que el hotel acepte", async () => {
    const ficha = await fichaHotel(solicitud.slug, "en", criterios(5, 7, 3), db);
    assert.equal(ficha?.opciones[0].modo, "solicitud");
    assert.equal(ficha?.opciones[0].totalCentavos, 20_000n); // (80 + 20) × 2 noches; ocupación 4 cubre a 3 huéspedes
    assert.equal(ficha?.opciones[0].habitacion, "Cabaña"); // sin traducción al inglés, cae al español

    const reserva = await crearReserva({ hotelSlug: solicitud.slug, tipoHabitacionId: solicitud.habitacion, planTarifaId: solicitud.plan, ...criterios(5, 7, 3), titular }, db);
    assert.equal(reserva.estado, "solicitada");
    const id = (await db.query<{ id: string }>("SELECT id FROM reservas.reservas WHERE codigo = $1", [reserva.codigo])).rows[0].id;
    await aceptarSolicitud(wopa, id, "https://wopa.test", db);
    const correo = await db.query<{ cuerpo_texto: string }>("SELECT cuerpo_texto FROM notificaciones.correos WHERE plantilla = 'solicitud_aceptada'");
    assert.ok(correo.rows[0].cuerpo_texto.includes(`https://wopa.test/es/reservar/${reserva.codigo}`));
    assert.equal((await consultarReserva(reserva.codigo, titular.correo, db))?.estado, "pendiente_pago");
    await assert.rejects(rechazarSolicitud(wopa, id, "tarde", db), { codigo: "ESTADO_INVALIDO" });
  });
});
