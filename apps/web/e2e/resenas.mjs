// Reseña real: una estadía completada opina desde el formulario; tras moderarla aparece en la ficha.
// Uso: node apps/web/e2e/resenas.mjs [url]. Requiere el servidor y la base local con hoteles importados.
import pg from "pg";

const base = process.argv[2] ?? "http://localhost:3100";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://wopa:wopa_local@localhost:5433/wopa" });
await db.connect();
function comprobar(condicion, mensaje) {
  if (!condicion) throw new Error(`FALLÓ: ${mensaje}`);
  console.log(`✔ ${mensaje}`);
}
async function enviar(ruta, campos) {
  const pagina = await fetch(base + ruta).then((r) => r.text());
  const formulario = pagina.split("<form").slice(1).map((f) => f.split("</form>")[0]).find((f) => f.includes('name="puntaje"'));
  const datos = new FormData();
  for (const [, atributos] of formulario.matchAll(/<input([^>]*)>/g)) {
    const nombre = /name="([^"]+)"/.exec(atributos)?.[1];
    if (nombre && /type="hidden"/.test(atributos)) datos.append(nombre, (/value="([^"]*)"/.exec(atributos)?.[1] ?? "").replaceAll("&amp;", "&"));
  }
  for (const [nombre, valor] of Object.entries(campos)) datos.set(nombre, valor);
  const respuesta = await fetch(base + ruta, { method: "POST", body: datos, headers: { origin: base }, redirect: "manual" });
  return respuesta.headers.get("location") ?? "";
}

// Prepara una estadía completada en Hotel Regatta.
const hotel = (await db.query("SELECT h.id, t.id AS habitacion, p.id AS plan FROM catalogo.hoteles h JOIN catalogo.tipos_habitacion t ON t.hotel_id = h.id JOIN tarifas.planes_tarifa p ON p.hotel_id = h.id WHERE h.slug = 'hotel-regatta'")).rows[0];
const codigo = `WP-${Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[^A-Z0-9]/g, "X").padEnd(6, "X")}`;
const correo = `resena.${Date.now()}@example.test`;
const comentario = `Excelente atención y vista al mar (${Date.now()}).`;
const reserva = (await db.query(
  `INSERT INTO reservas.reservas (codigo, hotel_id, estado, fecha_entrada, fecha_salida, idioma_codigo, moneda_codigo, total_venta_centavos, anticipo_centavos,
     titular_nombre, titular_correo, titular_telefono, politica_cancelacion)
   VALUES ($1, $2, 'completada', current_date - 4, current_date - 2, 'es', 'USD', 32000, 8000, 'Huésped Feliz', $3, '+50760000000', '{"reglas":[],"descripcion":""}') RETURNING id`,
  [codigo, hotel.id, correo],
)).rows[0].id;
await db.query("INSERT INTO reservas.reserva_lineas (reserva_id, hotel_id, tipo_habitacion_id, plan_tarifa_id, adultos) VALUES ($1, $2, $3, $4, 2)", [reserva, hotel.id, hotel.habitacion, hotel.plan]);

const ajeno = await enviar(`/es/opinar?codigo=${codigo}`, { codigo, correo: "otro@example.test", puntaje: "5", comentario: "", nombre: "X" });
comprobar(ajeno.includes("error=RESERVA_NO_ENCONTRADA"), "con otro correo no se puede opinar");
const enviada = await enviar(`/es/opinar?codigo=${codigo}`, { codigo, correo, puntaje: "5", comentario, nombre: "Huésped F." });
comprobar(enviada.includes("enviada=1"), "el huésped envía su opinión");
const repetida = await enviar(`/es/opinar?codigo=${codigo}`, { codigo, correo, puntaje: "1", comentario: "", nombre: "Otra vez" });
comprobar(repetida.includes("error=RESENA_EXISTENTE"), "no puede opinar dos veces sobre la misma estadía");

let ficha = await fetch(`${base}/es/hotel/hotel-regatta`).then((r) => r.text());
comprobar(!ficha.includes(comentario), "sin moderar, no aparece en la ficha");
await db.query("UPDATE reservas.resenas SET estado = 'publicada', moderada_en = now() WHERE reserva_id = $1", [reserva]);
ficha = await fetch(`${base}/es/hotel/hotel-regatta`).then((r) => r.text());
comprobar(ficha.includes(comentario) && ficha.includes('"@type":"AggregateRating"'), "publicada, aparece en la ficha con la calificación para buscadores");
await db.end();
console.log("Recorrido de reseñas completo sin errores.");
