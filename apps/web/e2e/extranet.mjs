// Recorre la extranet real: WOPA invita al hotel → el hotel activa su cuenta y 2FA → carga cupos y propone un texto → WOPA lo aprueba.
// Uso: node apps/web/e2e/extranet.mjs "$(pwd)" [url]. Requiere el servidor, la base local y admin@wopa.local sin 2FA (como e2e:acceso).
import { pathToFileURL } from "node:url";
import pg from "pg";

const raiz = process.argv[2];
const base = process.argv[3] ?? "http://localhost:3100";
const { codigoTotp } = await import(pathToFileURL(`${raiz}/packages/dominio/src/identidad/index.ts`).href);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://wopa:wopa_local@localhost:5433/wopa" });
await db.connect();
const correoHotel = `gerente.${Date.now()}@mintaka.test`;

function navegador() {
  let cookie = "";
  const guardar = (respuesta) => {
    for (const linea of respuesta.headers.getSetCookie?.() ?? []) {
      const [par] = linea.split(";");
      const [nombre] = par.split("=");
      cookie = [...cookie.split("; ").filter((c) => c && !c.startsWith(`${nombre}=`)), par].join("; ");
    }
  };
  return {
    async obtener(ruta) {
      const respuesta = await fetch(base + ruta, { headers: { cookie }, redirect: "manual" });
      guardar(respuesta);
      return { estado: respuesta.status, html: await respuesta.text(), destino: respuesta.headers.get("location") };
    },
    async enviar(ruta, campos) {
      const datos = new FormData();
      for (const [nombre, valor] of Object.entries(campos)) datos.append(nombre, valor);
      const respuesta = await fetch(base + ruta, { method: "POST", body: datos, headers: { cookie, origin: base }, redirect: "manual" });
      guardar(respuesta);
      return { estado: respuesta.status, destino: respuesta.headers.get("location") };
    },
  };
}
function campos(html, marcador) {
  const formulario = html.split("<form").slice(1).map((f) => f.split("</form>")[0]).find((f) => f.includes(marcador));
  if (!formulario) throw new Error(`No encontré el formulario con ${marcador}`);
  const resultado = {};
  for (const [, atributos] of formulario.matchAll(/<input([^>]*)>/g)) {
    const nombre = /name="([^"]+)"/.exec(atributos)?.[1];
    if (nombre && /type="hidden"/.test(atributos)) resultado[nombre] = (/value="([^"]*)"/.exec(atributos)?.[1] ?? "").replaceAll("&amp;", "&");
  }
  return resultado;
}
function comprobar(condicion, mensaje) {
  if (!condicion) throw new Error(`FALLÓ: ${mensaje}`);
  console.log(`✔ ${mensaje}`);
}
async function entrarConDosPasos(nav, correo, clave) {
  const acceso = await nav.obtener("/acceso");
  await nav.enviar("/acceso", { ...campos(acceso.html, 'name="correo"'), correo, clave });
  const pagina = await nav.obtener("/acceso/2fa");
  const secreto = /<code class="secreto">([A-Z2-7]+)<\/code>/.exec(pagina.html)?.[1];
  return nav.enviar("/acceso/2fa", { ...campos(pagina.html, 'name="codigo"'), codigo: codigoTotp(secreto) });
}

// WOPA invita al gerente de Mintaka.
const wopa = navegador();
const entradaWopa = await entrarConDosPasos(wopa, "admin@wopa.local", "clave local muy segura");
comprobar(entradaWopa.destino?.endsWith("/admin"), "WOPA entra al panel");
const hotelId = (await db.query("SELECT id FROM catalogo.hoteles WHERE slug = 'mintaka-hotel-and-lounge'")).rows[0].id;
const ficha = await wopa.obtener(`/admin/hoteles/${hotelId}`);
const invitacion = await wopa.enviar(`/admin/hoteles/${hotelId}`, { ...campos(ficha.html, 'id="correo-invitar"'), correo: correoHotel, rol: "hotel_admin" });
comprobar(invitacion.destino?.includes("ok=1"), "WOPA invita al gerente del hotel");

// El gerente activa su cuenta con el enlace del correo.
const correo = (await db.query("SELECT cuerpo_texto FROM notificaciones.correos WHERE para = $1 AND plantilla = 'invitacion'", [correoHotel])).rows[0].cuerpo_texto;
const enlace = new URL(/https?:\/\/\S+/.exec(correo)[0]);
const hotel = navegador();
const paginaInvitacion = await hotel.obtener(enlace.pathname + enlace.search);
comprobar(paginaInvitacion.html.includes("Mintaka"), "el enlace de la invitación muestra el hotel");
const activada = await hotel.enviar("/acceso/invitacion", { ...campos(paginaInvitacion.html, 'name="nombre"'), nombre: "Gerente Mintaka", clave: "clave del hotel muy segura", clave2: "clave del hotel muy segura" });
comprobar(activada.destino?.includes("activada=1"), "el gerente activa su cuenta");
const entradaHotel = await entrarConDosPasos(hotel, correoHotel, "clave del hotel muy segura");
comprobar(entradaHotel.destino?.endsWith("/extranet"), "el gerente entra a la extranet con verificación en dos pasos");
comprobar((await hotel.obtener("/admin")).destino?.endsWith("/extranet"), "el gerente no puede entrar al panel de WOPA");

// Trabajo del hotel.
const extranet = await hotel.obtener("/extranet");
comprobar(extranet.html.includes("Mintaka Hotel and Lounge") && !extranet.html.includes("Hotel Regatta"), "la extranet muestra solo su hotel");
const pagina = await hotel.obtener(`/extranet/hoteles/${hotelId}`);
comprobar(pagina.html.includes("Calendario de tarifa neta y cupos"), "ve el calendario de su hotel");
const hoy = new Date();
const dia = (n) => new Date(hoy.getTime() + n * 86400000).toISOString().slice(0, 10);
const cupos = await hotel.enviar(`/extranet/hoteles/${hotelId}`, { ...campos(pagina.html, 'id="cupoTotal"'), desde: dia(100), hasta: dia(102), cupoTotal: "7" });
comprobar(cupos.destino?.includes("ok=1"), "carga cupos por rango");
const fila = (await db.query("SELECT cupo_total FROM tarifas.cupos_dia c JOIN catalogo.tipos_habitacion t ON t.id = c.tipo_habitacion_id WHERE t.hotel_id = $1 AND c.fecha = $2", [hotelId, dia(101)])).rows[0];
comprobar(fila?.cupo_total === 7, "el cupo queda guardado");
const texto = `Hotel boutique en Cartagena, cerca de la playa y del centro histórico. Revisión ${Date.now()}.`;
const propuesta = await hotel.enviar(`/extranet/hoteles/${hotelId}`, { ...campos(pagina.html, 'id="descripcion"'), idioma: "en", descripcion: texto, comoLlegar: "" });
comprobar(propuesta.destino?.includes("ok=1"), "propone una descripción en inglés");

// WOPA revisa y publica.
const salud = await wopa.obtener("/admin/salud");
comprobar(salud.html.includes(texto), "WOPA ve el cambio pendiente en Supervisión");
const marcador = salud.html.split("<article").find((a) => a.includes(texto));
const revisionId = /name="revisionId" value="([^"]+)"/.exec(marcador)[1];
const aprobacion = await wopa.enviar("/admin/salud", { ...campos(salud.html, `value="${revisionId}"`), comentario: "", accion: "aprobar" });
comprobar(aprobacion.destino?.includes("ok=1"), "WOPA aprueba el cambio");
const publicada = await fetch(`${base}/en/hotel/mintaka-hotel-and-lounge`).then((r) => r.text());
comprobar(publicada.includes(texto), "la descripción en inglés aparece en la web pública");
await db.end();
console.log("Recorrido de la extranet completo sin errores.");
