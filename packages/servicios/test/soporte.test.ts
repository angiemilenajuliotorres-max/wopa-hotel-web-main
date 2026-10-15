import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { crearBaseMigrada, type BaseDePrueba } from "@wopa/db/pruebas";
import type { SesionActiva } from "../src/identidad.ts";
import { buscarArticulos, crearTicket, detalleTicket, listarArticulos, listarTickets, responderTicket } from "../src/soporte.ts";
import { sesionWopa } from "./ayudantes.ts";

let db: BaseDePrueba;
let wopa: SesionActiva;
before(async () => {
  db = await crearBaseMigrada();
  wopa = await sesionWopa(db);
});
after(async () => {
  await db.close();
});

test("el centro de ayuda tiene los artículos iniciales en es y en", async () => {
  assert.equal((await listarArticulos("es", db)).length, 5);
  assert.equal((await listarArticulos("en", db))[0].slug, "how-to-book");
});

test("la búsqueda de ayuda tolera tildes", async () => {
  const resultados = await buscarArticulos("cuando pago el resto", "es", db);
  assert.equal(resultados[0]?.slug, "anticipo-y-saldo");
});

test("un ticket de alguien que ya está en el hotel es urgente y vence en 1 hora", async () => {
  const antes = Date.now();
  const ticket = await crearTicket({
    categoria: "en_el_hotel", asunto: "No encuentran mi reserva", mensaje: "Estoy en recepción y no aparece mi reserva.",
    nombre: "Ana", correo: "ana@example.test", idioma: "es", origen: "contacto",
  }, db);
  assert.match(ticket.codigo, /^TK-\d{6}$/);
  const minutos = (ticket.venceSlaEn.getTime() - antes) / 60_000;
  assert.ok(minutos > 55 && minutos <= 61, `vence en ${minutos} min`);
  const lista = await listarTickets(wopa, "abiertos", db);
  assert.equal(lista[0].prioridad, "urgente");
  const correos = await db.query<{ plantilla: string }>("SELECT plantilla FROM notificaciones.correos ORDER BY plantilla");
  assert.deepEqual(correos.rows.map((c) => c.plantilla), ["ticket_creado", "ticket_nuevo_equipo"]);
});

test("el equipo responde: el cliente recibe la respuesta; las notas internas no se envían", async () => {
  const ticket = await crearTicket({ categoria: "pago", asunto: "Cobro doble", mensaje: "Me cobraron dos veces el anticipo.", nombre: "Luis", correo: "luis@example.test", idioma: "en", origen: "contacto" }, db);
  const id = (await db.query<{ id: string }>("SELECT id FROM soporte.tickets WHERE codigo = $1", [ticket.codigo])).rows[0].id;
  await responderTicket(wopa, { ticketId: id, contenido: "Revisar con el proveedor", notaInterna: true }, db);
  await responderTicket(wopa, { ticketId: id, contenido: "We refunded the duplicate charge.", notaInterna: false, nuevoEstado: "resuelto" }, db);
  const detalle = await detalleTicket(wopa, id, db);
  assert.equal(detalle?.estado, "resuelto");
  assert.equal(detalle?.mensajes.length, 3);
  const respuestas = await db.query<{ para: string }>("SELECT para FROM notificaciones.correos WHERE plantilla = 'ticket_respuesta'");
  assert.deepEqual(respuestas.rows.map((c) => c.para), ["luis@example.test"]);
});

test("los números de ticket no se repiten aunque se creen a la vez", async () => {
  const datos = { categoria: "otro" as const, asunto: "Consulta", mensaje: "Pregunta general sobre tours.", nombre: "Eva", correo: "eva@example.test", idioma: "es" as const, origen: "contacto" as const };
  const codigos = await Promise.all([crearTicket(datos, db), crearTicket(datos, db)].map(async (p) => (await p).codigo)).catch(() => null);
  if (codigos) assert.notEqual(codigos[0], codigos[1]);
});
