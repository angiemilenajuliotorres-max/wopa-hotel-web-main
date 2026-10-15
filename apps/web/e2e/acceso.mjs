// Uso: node apps/web/e2e/acceso.mjs "$(pwd)" [url]. Requiere el servidor en marcha, la base migrada y el
// administrador admin@wopa.local / "clave local muy segura" sin 2FA configurada (ver docs/README.md).
// Recorre el acceso real: login → configurar 2FA → panel → ficha de hotel.
// Usa los formularios con mejora progresiva de Next (sin JavaScript), igual que un navegador básico.
import { pathToFileURL } from "node:url";

const raiz = process.argv[2];
const base = process.argv[3] ?? "http://localhost:3100";
const { codigoTotp } = await import(pathToFileURL(`${raiz}/packages/dominio/src/identidad/index.ts`).href);

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

/** Busca el formulario que contiene `marcador` y devuelve sus campos ocultos (incluido el id de la acción). */
function camposDelFormulario(html, marcador) {
  const formularios = html.split("<form").slice(1).map((f) => f.split("</form>")[0]);
  const formulario = formularios.find((f) => f.includes(marcador));
  if (!formulario) throw new Error(`No encontré el formulario con ${marcador}`);
  const campos = {};
  for (const [, atributos] of formulario.matchAll(/<input([^>]*)>/g)) {
    const nombre = /name="([^"]+)"/.exec(atributos)?.[1];
    const valor = /value="([^"]*)"/.exec(atributos)?.[1] ?? "";
    if (nombre && /type="hidden"/.test(atributos)) campos[nombre] = valor.replaceAll("&amp;", "&");
  }
  return campos;
}

async function enviar(ruta, campos) {
  const datos = new FormData();
  for (const [nombre, valor] of Object.entries(campos)) datos.append(nombre, valor);
  const respuesta = await fetch(base + ruta, { method: "POST", body: datos, headers: { cookie, origin: base }, redirect: "manual" });
  guardarCookies(respuesta);
  return { estado: respuesta.status, destino: respuesta.headers.get("location"), html: await respuesta.text() };
}

function comprobar(condicion, mensaje) {
  if (!condicion) throw new Error(`FALLÓ: ${mensaje}`);
  console.log(`✔ ${mensaje}`);
}

const acceso = await obtener("/acceso");
const login = await enviar("/acceso", { ...camposDelFormulario(acceso.html, 'name="correo"'), correo: "admin@wopa.local", clave: "clave local muy segura" });
comprobar(login.destino?.endsWith("/acceso/2fa"), `login redirige a la 2FA (${login.estado} → ${login.destino})`);
comprobar(cookie.includes("wopa_sesion="), "se guarda la cookie de sesión");

const malo = await enviar("/acceso", { ...camposDelFormulario(acceso.html, 'name="correo"'), correo: "admin@wopa.local", clave: "clave equivocada larga" });
comprobar(malo.destino?.includes("error=CREDENCIALES_INVALIDAS"), "una clave incorrecta vuelve con el error");

const sinPermiso = await obtener("/admin");
comprobar(sinPermiso.destino?.endsWith("/acceso/2fa"), "sin la 2FA el panel redirige a configurarla");

const pagina2fa = await obtener("/acceso/2fa");
const secreto = /<code class="secreto">([A-Z2-7]+)<\/code>/.exec(pagina2fa.html)?.[1];
comprobar(Boolean(secreto) && pagina2fa.html.includes("<svg"), "la página muestra el QR y la clave manual");
const confirmado = await enviar("/acceso/2fa", { ...camposDelFormulario(pagina2fa.html, 'name="codigo"'), codigo: codigoTotp(secreto) });
comprobar(confirmado.destino?.endsWith("/admin"), `con el código TOTP correcto entra al panel (${confirmado.destino})`);

const panel = await obtener("/admin");
comprobar(panel.estado === 200 && panel.html.includes("Hotel Regatta"), "el panel lista los hoteles importados");
comprobar(panel.html.includes("30 %"), "muestra el margen vigente del 30 %");

const enlace = /href="(\/admin\/hoteles\/[0-9a-f-]{36})"/.exec(panel.html)?.[1];
const ficha = await obtener(enlace);
comprobar(ficha.estado === 200 && ficha.html.includes("Márgenes de WOPA"), "la ficha muestra el historial de márgenes");

const ajuste = await enviar(enlace, {
  ...camposDelFormulario(ficha.html, 'id="motivo-ajuste"'),
  margenTipo: "porcentaje", margenValor: "35", desde: new Date(Date.now() + (60 + Math.floor((Date.now() - Date.UTC(2026, 9, 15)) / 60000)) * 86400000).toISOString().slice(0, 10), hasta: "", planTarifaId: "", motivo: "Prueba de temporada alta",
});
comprobar(ajuste.destino?.includes("ok=1"), `WOPA ajusta el margen desde el panel (${ajuste.destino})`);
const fichaDespues = await obtener(enlace);
comprobar(fichaDespues.html.includes("Prueba de temporada alta") && fichaDespues.html.includes("35 %"), "el ajuste aparece en el historial");
const reservas = await obtener("/admin/reservas");
comprobar(reservas.estado === 200 && /WP-[A-Z0-9]{6}/.test(reservas.html), "el panel lista las reservas");
const soporte = await obtener("/admin/soporte?todos=1");
const enlaceTicket = /href="(\/admin\/soporte\/[0-9a-f-]{36})"/.exec(soporte.html)?.[1];
comprobar(soporte.estado === 200 && Boolean(enlaceTicket), "el panel lista los tickets");
const ticket = await obtener(enlaceTicket);
const respuesta = await enviar(enlaceTicket, { ...camposDelFormulario(ticket.html, 'id="contenido"'), contenido: "Sí, coordinamos traslados. Te escribimos con opciones.", nuevoEstado: "resuelto" });
comprobar(respuesta.destino?.includes("ok=1"), "el equipo responde un ticket");
const correos = await obtener("/admin/correos");
comprobar(correos.html.includes("Respuesta a tu consulta"), "la respuesta queda en la bandeja de correos");
console.log("Recorrido completo sin errores.");
