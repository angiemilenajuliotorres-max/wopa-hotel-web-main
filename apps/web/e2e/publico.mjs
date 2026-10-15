// Recorre la web pública real: portada → autocompletado → resultados → ficha → reserva → Mi reserva → cancelación → ayuda.
// Uso: node apps/web/e2e/publico.mjs [url]. Requiere el servidor en marcha y los hoteles importados de la web heredada.
const base = process.argv[2] ?? "http://localhost:3100";
let cookie = "";

function guardarCookies(respuesta) {
  for (const linea of respuesta.headers.getSetCookie?.() ?? []) {
    const [par] = linea.split(";");
    const [nombre] = par.split("=");
    cookie = [...cookie.split("; ").filter((c) => c && !c.startsWith(`${nombre}=`)), par].join("; ");
  }
}
async function obtener(ruta) {
  const respuesta = await fetch(base + ruta, { headers: { cookie }, redirect: "manual" });
  guardarCookies(respuesta);
  return { estado: respuesta.status, html: await respuesta.text(), destino: respuesta.headers.get("location") };
}
function camposDelFormulario(html, marcador) {
  const formulario = html.split("<form").slice(1).map((f) => f.split("</form>")[0]).find((f) => f.includes(marcador));
  if (!formulario) throw new Error(`No encontré el formulario con ${marcador}`);
  const campos = {};
  for (const [, atributos] of formulario.matchAll(/<input([^>]*)>/g)) {
    const nombre = /name="([^"]+)"/.exec(atributos)?.[1];
    if (nombre && /type="hidden"/.test(atributos)) campos[nombre] = (/value="([^"]*)"/.exec(atributos)?.[1] ?? "").replaceAll("&amp;", "&");
  }
  return campos;
}
async function enviar(ruta, campos) {
  const datos = new FormData();
  for (const [nombre, valor] of Object.entries(campos)) datos.append(nombre, valor);
  const respuesta = await fetch(base + ruta, { method: "POST", body: datos, headers: { cookie, origin: base }, redirect: "manual" });
  guardarCookies(respuesta);
  return { estado: respuesta.status, destino: respuesta.headers.get("location") };
}
function comprobar(condicion, mensaje) {
  if (!condicion) throw new Error(`FALLÓ: ${mensaje}`);
  console.log(`✔ ${mensaje}`);
}
const dia = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const fechas = `entrada=${dia(20)}&salida=${dia(22)}&huespedes=2`;

const raiz = await fetch(base + "/", { redirect: "manual", headers: { "accept-language": "en-US,en;q=0.9" } });
comprobar(raiz.headers.get("location")?.endsWith("/en"), "la raíz redirige al idioma del navegador (/en)");

const portada = await obtener("/es");
comprobar(portada.estado === 200 && portada.html.includes("Cartagena de Indias") && portada.html.includes('lang="es"'), "la portada en español muestra los destinos");

const sugerencias = await (await fetch(`${base}/api/v1/destinos?q=cartajena&idioma=es`)).json();
comprobar(sugerencias.destinos.some((d) => d.tipo === "ciudad" && d.slug === "cartagena"), "el autocompletado tolera errores de escritura (cartajena)");

const resultados = await obtener(`/es/buscar?destino=ciudad:cartagena&${fechas}`);
comprobar(resultados.html.includes("Hotel Regatta") && resultados.html.includes("Total de la estadía"), "los resultados muestran hoteles con precio total");
comprobar(/(USD|US$)/.test(resultados.html) && resultados.html.includes("Pagas hoy"), "y el anticipo a pagar hoy");

const ficha = await obtener(`/en/hotel/hotel-regatta?${fechas}`);
comprobar(ficha.estado === 200 && ficha.html.includes("Rooms and prices") && ficha.html.includes('"@type":"Hotel"'), "la ficha en inglés tiene opciones y datos estructurados");
const enlaceReserva = /href="(\/en\/reservar\/nueva\?[^"]+)"/.exec(ficha.html)?.[1]?.replaceAll("&amp;", "&");
comprobar(Boolean(enlaceReserva), "hay un botón para solicitar la reserva");

const formulario = await obtener(enlaceReserva);
comprobar(formulario.html.includes("Pay today (deposit)"), "el formulario separa lo que se paga hoy y en el hotel");
const reserva = await enviar(enlaceReserva, {
  ...camposDelFormulario(formulario.html, 'name="nombre"'),
  nombre: "Ana Prueba", correo: "ana.e2e@example.test", telefono: "+507 6000-0000", pais: "PA", solicitudes: "",
});
const codigo = /\/reservar\/(WP-[A-Z0-9]{6})/.exec(reserva.destino ?? "")?.[1];
comprobar(Boolean(codigo) && cookie.includes("wopa_reservas="), `la solicitud crea la reserva ${codigo} y da acceso sin cuenta`);

const estado = await obtener(`/en/reservar/${codigo}`);
comprobar(estado.html.includes("Request sent") && estado.html.includes("You have not been charged"), "la reserva queda como solicitud, sin cobro");

const cancelar = await enviar(`/en/reservar/${codigo}`, camposDelFormulario(estado.html, "Yes, cancel my booking"));
comprobar(cancelar.destino?.includes("cancelada=1"), "el viajero cancela desde Mi reserva");
comprobar((await obtener(`/en/reservar/${codigo}`)).html.includes("Cancelled"), "la reserva aparece cancelada");

const miReserva = await obtener("/es/mi-reserva");
const ajena = await enviar("/es/mi-reserva", { ...camposDelFormulario(miReserva.html, 'name="codigo"'), codigo, correo: "otra@example.test" });
comprobar(ajena.destino?.includes("error=RESERVA_NO_ENCONTRADA"), "con otro correo no se puede ver la reserva");

const ayuda = await obtener("/es/ayuda");
comprobar(ayuda.html.includes("¿Qué es el anticipo"), "el centro de ayuda muestra las preguntas frecuentes");
const ticket = await enviar("/es/ayuda", {
  ...camposDelFormulario(ayuda.html, 'name="asunto"'),
  categoria: "otro", nombre: "Ana Prueba", correo: "ana.e2e@example.test", reserva: "", asunto: "Traslado", mensaje: "¿Ofrecen traslado desde el aeropuerto?",
});
comprobar(/enviado=TK-\d{6}/.test(ticket.destino ?? ""), "el formulario de ayuda crea un ticket");

const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
comprobar(sitemap.includes("/hotel/hotel-regatta") && sitemap.includes('hreflang="en"'), "el sitemap incluye hoteles con alternativa en inglés");
console.log("Recorrido público completo sin errores.");
