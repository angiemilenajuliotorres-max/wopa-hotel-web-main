import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { crearBaseMigrada, type BaseDePrueba } from "@wopa/db/pruebas";
import { codigoTotp } from "@wopa/dominio/identidad";
import { aceptarHotel, cargarCupos, cargarTarifaNeta, crearHotel, crearTipoHabitacion } from "../src/catalogo.ts";
import { calendarioHabitacion, generarAlertas, hotelesDeSesion, listarRevisiones, proponerCambioContenido, resolverRevision, saludHoteles } from "../src/extranet.ts";
import {
  aceptarInvitacion,
  confirmarConfiguracion2fa,
  iniciarConfiguracion2fa,
  iniciarSesion,
  invitarUsuario,
  obtenerSesion,
  type SesionActiva,
} from "../src/identidad.ts";
import { CLAVE_PRUEBA, fecha, idCiudad, idPlanBase, sesionWopa } from "./ayudantes.ts";

let db: BaseDePrueba;
let wopa: SesionActiva;
let gerente: SesionActiva;
let hotel: { hotelId: string; organizacionId: string; habitacion: string; plan: string };
let otroHotel: string;

before(async () => {
  db = await crearBaseMigrada();
  wopa = await sesionWopa(db);
  const ciudad = await idCiudad(db, "bocas-del-toro");
  const creado = await crearHotel(wopa, { nombre: "Isla Verde Lodge", ciudadId: ciudad, monedaCodigo: "USD", direccion: "Isla Colón", latitud: 9.34, longitud: -82.24 }, db);
  const habitacion = await crearTipoHabitacion(wopa, { hotelId: creado.hotelId, codigo: "bungalow", capacidadMaxima: 2, nombre: { es: "Bungalow" } }, db);
  const plan = await idPlanBase(db, creado.hotelId);
  await cargarTarifaNeta(wopa, { hotelId: creado.hotelId, planTarifaId: plan, tipoHabitacionId: habitacion, desde: fecha(0), hasta: fecha(60), ocupacion: 2, netoCentavos: 9_000n }, db);
  await aceptarHotel(wopa, { hotelId: creado.hotelId, margen: { tipo: "porcentaje", porcentajeBp: 2500 }, desde: fecha(0) }, db);
  hotel = { hotelId: creado.hotelId, organizacionId: creado.organizacionId, habitacion, plan };
  otroHotel = (await crearHotel(wopa, { nombre: "Otro Hotel", ciudadId: ciudad, monedaCodigo: "USD", direccion: "Bocas", latitud: 9.3, longitud: -82.2 }, db)).hotelId;

  // El gerente entra por invitación de WOPA y configura su 2FA.
  const { token } = await invitarUsuario({ sesion: wopa, organizacionId: creado.organizacionId, correo: "gerente@islaverde.test", rol: "hotel_admin", urlBase: "https://wopa.test" }, db);
  await aceptarInvitacion({ token, nombre: "Gerente Isla Verde", clave: CLAVE_PRUEBA }, db);
  const acceso = await iniciarSesion({ correo: "gerente@islaverde.test", clave: CLAVE_PRUEBA }, db);
  const { secreto } = await iniciarConfiguracion2fa(acceso.token, db);
  await confirmarConfiguracion2fa(acceso.token, codigoTotp(secreto), db);
  gerente = (await obtenerSesion(acceso.token, db))!;
});
after(async () => {
  await db.close();
});

test("el hotel solo ve y gestiona su propio hotel", async () => {
  assert.deepEqual((await hotelesDeSesion(gerente, db)).map((h) => h.nombre), ["Isla Verde Lodge"]);
  assert.equal((await hotelesDeSesion(wopa, db)).length, 2);
  await assert.rejects(cargarCupos(gerente, { hotelId: otroHotel, tipoHabitacionId: hotel.habitacion, desde: fecha(1), hasta: fecha(2), cupoTotal: 3 }, db), { codigo: "SIN_PERMISO" });
});

test("el hotel carga cupos y los ve en su calendario junto con su tarifa neta", async () => {
  await cargarCupos(gerente, { hotelId: hotel.hotelId, tipoHabitacionId: hotel.habitacion, desde: fecha(1), hasta: fecha(10), cupoTotal: 4 }, db);
  await cargarCupos(gerente, { hotelId: hotel.hotelId, tipoHabitacionId: hotel.habitacion, desde: fecha(5), hasta: fecha(5), cerrado: true }, db);
  const calendario = await calendarioHabitacion(gerente, { hotelId: hotel.hotelId, tipoHabitacionId: hotel.habitacion, desde: fecha(1), dias: 7 }, db);
  assert.equal(calendario.length, 7);
  assert.equal(Number(calendario[0].netos?.["2"]), 9_000);
  assert.equal(calendario[0].cupo_total, 4);
  assert.equal(calendario[4].esta_cerrado, true);
  await assert.rejects(calendarioHabitacion(gerente, { hotelId: otroHotel, tipoHabitacionId: hotel.habitacion, desde: fecha(1), dias: 7 }, db), { codigo: "SIN_PERMISO" });
});

test("un cambio de descripción del hotel se publica solo cuando WOPA lo aprueba", async () => {
  const revision = await proponerCambioContenido(gerente, hotel.hotelId, { idioma: "en", descripcion: "Overwater bungalows a short boat ride from Bocas town." }, db);
  const antes = await db.query("SELECT 1 FROM catalogo.hotel_traducciones WHERE hotel_id = $1 AND idioma_codigo = 'en'", [hotel.hotelId]);
  assert.equal(antes.rows.length, 0);
  await assert.rejects(listarRevisiones(gerente, db), { codigo: "SIN_PERMISO" });
  assert.equal((await listarRevisiones(wopa, db)).length, 1);

  await resolverRevision(wopa, revision, true, null, db);
  const despues = await db.query<{ descripcion: string; esta_revisada: boolean }>("SELECT descripcion, esta_revisada FROM catalogo.hotel_traducciones WHERE hotel_id = $1 AND idioma_codigo = 'en'", [hotel.hotelId]);
  assert.deepEqual(despues.rows[0], { descripcion: "Overwater bungalows a short boat ride from Bocas town.", esta_revisada: true });
  await assert.rejects(resolverRevision(wopa, revision, false, "tarde", db), { codigo: "ESTADO_INVALIDO" });
});

test("el semáforo y las alertas señalan hoteles sin cupo o sin inglés", async () => {
  await db.query("UPDATE catalogo.hoteles SET modo_reserva = 'anticipo_en_linea' WHERE id = $1", [hotel.hotelId]);
  const creadas = await generarAlertas(db);
  assert.ok(creadas >= 1);
  const alertas = await db.query<{ tipo: string }>("SELECT tipo FROM auditoria.alertas WHERE hotel_id = $1 ORDER BY tipo", [hotel.hotelId]);
  assert.ok(alertas.rows.some((a) => a.tipo === "sin_cupo_prolongado")); // solo hay cupo en 9 de los próximos 30 días
  assert.equal(await generarAlertas(db) >= 1, true);
  const repetidas = await db.query("SELECT 1 FROM auditoria.alertas WHERE hotel_id = $1 AND tipo = 'sin_cupo_prolongado'", [hotel.hotelId]);
  assert.equal(repetidas.rows.length, 1); // no se duplican mientras sigan abiertas

  const salud = (await saludHoteles(wopa, db)).find((h) => h.id === hotel.hotelId)!;
  assert.equal(salud.semaforo, "rojo");
  assert.ok(salud.motivos.some((m) => m.includes("sin cupo")));
});
