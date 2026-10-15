import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { crearBaseMigrada, type BaseDePrueba } from "@wopa/db/pruebas";
import { enviarMensaje, iniciarConversacion, MODELO_ASISTENTE } from "../src/asistente.ts";

let db: BaseDePrueba;
before(async () => {
  db = await crearBaseMigrada();
});
after(async () => {
  await db.close();
});

/** Cliente falso: devuelve respuestas preparadas y guarda las peticiones recibidas. */
function clienteFalso(respuestas: Record<string, unknown>[]) {
  const peticiones: Record<string, any>[] = [];
  const cliente = {
    beta: {
      messages: {
        create: async (parametros: Record<string, any>) => {
          peticiones.push(structuredClone(parametros));
          const siguiente = respuestas.shift();
          if (!siguiente) throw new Error("Sin respuestas preparadas");
          return siguiente;
        },
      },
    },
  } as unknown as Anthropic;
  return { cliente, peticiones };
}

const usoHerramienta = (id: string, name: string, input: Record<string, unknown>) => ({
  stop_reason: "tool_use",
  content: [{ type: "thinking", thinking: "", signature: "firma" }, { type: "tool_use", id, name, input }],
});
const textoFinal = (text: string) => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });

test("sin clave de Anthropic responde con el centro de ayuda", async () => {
  const id = await iniciarConversacion({ idioma: "es", ip: "1.1.1.1" }, db);
  const { respuesta } = await enviarMensaje({ conversacionId: id, texto: "¿cómo cancelo una reserva y cuánto me devuelven?" }, { cliente: db, anthropic: null });
  assert.match(respuesta, /Mi reserva/);
});

test("usa herramientas, guarda el historial exacto y solo agrega al final", async () => {
  const { cliente, peticiones } = clienteFalso([
    usoHerramienta("t1", "buscar_destinos", { texto: "panama" }),
    textoFinal("Tenemos Ciudad de Panamá, Boquete y Bocas del Toro."),
    textoFinal("¡Con gusto!"),
  ]);
  const id = await iniciarConversacion({ idioma: "es", ip: "2.2.2.2" }, db);
  const primera = await enviarMensaje({ conversacionId: id, texto: "¿Qué destinos tienen en Panamá?" }, { cliente: db, anthropic: cliente });
  assert.equal(primera.respuesta, "Tenemos Ciudad de Panamá, Boquete y Bocas del Toro.");

  assert.equal(peticiones[0].model, MODELO_ASISTENTE);
  assert.deepEqual(peticiones[0].betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(peticiones[0].fallbacks, "default");
  const resultado = peticiones[1].messages[2].content[0];
  assert.equal(resultado.type, "tool_result");
  assert.ok(JSON.parse(resultado.content).some((d: { slug: string }) => d.slug === "ciudad-de-panama"));

  const { rows } = await db.query<{ historial_api: unknown[] }>("SELECT historial_api FROM soporte.conversaciones WHERE id = $1", [id]);
  assert.equal(rows[0].historial_api.length, 4); // usuario, asistente (con razonamiento y herramienta), resultado, asistente

  await enviarMensaje({ conversacionId: id, texto: "Gracias" }, { cliente: db, anthropic: cliente });
  assert.deepEqual(peticiones[2].messages.slice(0, 4), rows[0].historial_api); // el historial previo se reenvía sin cambios

  const mensajes = await db.query<{ autor: string; herramientas: unknown }>("SELECT autor, herramientas FROM soporte.mensajes WHERE conversacion_id = $1 ORDER BY creado_en, id", [id]);
  assert.deepEqual(mensajes.rows.map((m) => m.autor), ["cliente", "asistente", "cliente", "asistente"]);
  assert.ok(mensajes.rows[1].herramientas);
});

test("crea un ticket vinculado a la conversación cuando no puede resolver", async () => {
  const { cliente } = clienteFalso([
    usoHerramienta("t2", "crear_ticket", {
      categoria: "en_el_hotel", asunto: "No encuentran mi reserva", resumen: "El huésped está en recepción y el hotel no ve la reserva WP-AAAAAA.",
      nombre: "Ana", correo: "ana@example.test", codigo_reserva: null,
    }),
    textoFinal("Abrí el caso y el equipo te escribe en menos de una hora."),
  ]);
  const id = await iniciarConversacion({ idioma: "es", ip: "3.3.3.3" }, db);
  const { ticket } = await enviarMensaje({ conversacionId: id, texto: "Estoy en el hotel y no encuentran mi reserva" }, { cliente: db, anthropic: cliente });
  assert.match(ticket ?? "", /^TK-\d{6}$/);
  const conversacion = await db.query<{ estado: string }>("SELECT estado FROM soporte.conversaciones WHERE id = $1", [id]);
  assert.equal(conversacion.rows[0].estado, "escalada_a_ticket");
  const prioridad = await db.query<{ prioridad: string; origen: string }>("SELECT prioridad, origen FROM soporte.tickets WHERE codigo = $1", [ticket]);
  assert.deepEqual(prioridad.rows[0], { prioridad: "urgente", origen: "asistente" });
});

test("ante un rechazo del modelo responde con un mensaje seguro", async () => {
  const { cliente } = clienteFalso([{ stop_reason: "refusal", content: [] }]);
  const id = await iniciarConversacion({ idioma: "en", ip: "4.4.4.4" }, db);
  const { respuesta } = await enviarMensaje({ conversacionId: id, texto: "algo fuera de lugar" }, { cliente: db, anthropic: cliente });
  assert.match(respuesta, /help form/);
});

test("aplica el límite de mensajes por conversación", async () => {
  const id = await iniciarConversacion({ idioma: "es", ip: "5.5.5.5" }, db);
  await db.query("INSERT INTO soporte.mensajes (conversacion_id, autor, contenido) SELECT $1, 'cliente', 'hola' FROM generate_series(1, 40)", [id]);
  await assert.rejects(enviarMensaje({ conversacionId: id, texto: "otra" }, { cliente: db, anthropic: null }), { codigo: "LIMITE_CHAT" });
});
