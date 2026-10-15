// Recorre el cobro real del anticipo con la pasarela simulada: reserva → método → pasarela → confirmación → cancelación con reembolso.
// Uso: node apps/web/e2e/pagos.mjs [url]. Requiere DATABASE_URL local (prepara un hotel con cupos) y el servidor en marcha.
import pg from "pg";

const base = process.argv[2] ?? "http://localhost:3100";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://wopa:wopa_local@localhost:5433/wopa" });
await db.connect();
await db.query("UPDATE catalogo.hoteles SET modo_reserva = 'anticipo_en_linea' WHERE slug = 'mintaka-hotel-and-lounge'");
await db.query(`
  INSERT INTO tarifas.cupos_dia (tipo_habitacion_id, fecha, cupo_total)
  SELECT t.id, d::date, 5 FROM catalogo.tipos_habitacion t JOIN catalogo.hoteles h ON h.id = t.hotel_id,
       generate_series(current_date, current_date + 200, '1 day') d
  WHERE h.slug = 'mintaka-hotel-and-lounge'
  ON CONFLICT (tipo_habitacion_id, fecha) DO UPDATE SET cupo_total = 5, esta_cerrado = false`);

let cookie = "";
function guardarCookies(respuesta) {
  for (const linea of respuesta.headers.getSetCookie?.() ?? []) {
    const [par] = linea.split(";");
    const [nombre] = par.split("=");
    cookie = [...cookie.split("; ").filter((c) => c && !c.startsWith(`${nombre}=`)), par].join("; ");
  }
}
async function obtener(ruta) {
  const respuesta = await fetch(ruta.startsWith("http") ? ruta : base + ruta, { headers: { cookie }, redirect: "manual" });
  guardarCookies(respuesta);
  return { estado: respuesta.status, html: await respuesta.text(), destino: respuesta.headers.get("location") };
}
function formularios(html, marcador) {
  return html.split("<form").slice(1).map((f) => f.split("</form>")[0]).filter((f) => f.includes(marcador)).map((formulario) => {
    const campos = {};
    for (const [, atributos] of formulario.matchAll(/<input([^>]*)>/g)) {
      const nombre = /name="([^"]+)"/.exec(atributos)?.[1];
      if (nombre && /type="hidden"/.test(atributos)) campos[nombre] = (/value="([^"]*)"/.exec(atributos)?.[1] ?? "").replaceAll("&amp;", "&");
    }
    return campos;
  });
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
const fechas = `entrada=${dia(30)}&salida=${dia(32)}&huespedes=2`;

const ficha = await obtener(`/es/hotel/mintaka-hotel-and-lounge?${fechas}`);
const enlace = /href="(\/es\/reservar\/nueva\?[^"]+)"/.exec(ficha.html)?.[1]?.replaceAll("&amp;", "&");
comprobar(ficha.html.includes(">Reservar<") && Boolean(enlace), "el hotel con cupos ofrece reservar con pago en línea");
const formulario = await obtener(enlace);
const creada = await enviar(enlace, { ...formularios(formulario.html, 'name="nombre"')[0], nombre: "Pago Prueba", correo: "pago.e2e@example.test", telefono: "+507 6000-0000", pais: "PA", solicitudes: "" });
const codigo = /\/reservar\/(WP-[A-Z0-9]{6})/.exec(creada.destino ?? "")?.[1];
comprobar(Boolean(codigo), `se crea y retiene la reserva ${codigo}`);

const reserva = await obtener(`/es/reservar/${codigo}`);
const metodos = formularios(reserva.html, 'name="metodo"');
comprobar(reserva.html.includes("Pendiente de pago") && metodos.some((m) => m.metodo === "tarjeta"), "la reserva muestra los métodos de pago del país");

const pago = await enviar(`/es/reservar/${codigo}`, metodos.find((m) => m.metodo === "tarjeta"));
comprobar(/\/pagos\/simulado\/[0-9a-f-]{36}$/.test(pago.destino ?? ""), "al elegir tarjeta lleva a la página de la pasarela");
const pasarela = await obtener(pago.destino);
comprobar(pasarela.html.includes("Aprobar pago") && pasarela.html.includes(codigo), "la pasarela muestra el monto y la reserva");
const rutaPasarela = new URL(pago.destino, base).pathname;
const aprobado = await enviar(rutaPasarela, { ...formularios(pasarela.html, "Aprobar pago")[0], resultado: "aprobar" });
comprobar(aprobado.destino?.includes(`/es/reservar/${codigo}?pago=`), "al aprobar vuelve a la reserva");

const confirmada = await obtener(aprobado.destino);
comprobar(confirmada.html.includes("Confirmada") && !confirmada.html.includes('name="metodo"'), "la reserva queda confirmada por la notificación firmada");
const { rows } = await db.query("SELECT sum(monto_centavos)::int AS total FROM pagos.asientos a JOIN reservas.reservas r ON r.id = a.reserva_id WHERE r.codigo = $1", [codigo]);
comprobar(rows[0].total === 0, "los asientos del cobro cuadran");

const reenvio = await enviar(rutaPasarela, { ...formularios(pasarela.html, "Aprobar pago")[0], resultado: "aprobar" });
const pagosReserva = await db.query("SELECT p.estado FROM pagos.pagos p JOIN reservas.reservas r ON r.id = p.reserva_id WHERE r.codigo = $1", [codigo]);
comprobar(pagosReserva.rows.length === 1 && reenvio.estado !== 500, "reenviar la aprobación no cobra dos veces");

const cancelar = await enviar(`/es/reservar/${codigo}`, formularios(confirmada.html, "Sí, cancelar mi reserva")[0]);
// Hotel importado: política heredada que retiene el anticipo al cancelar (ADR-013), así que no hay reembolso.
comprobar(cancelar.destino?.includes("cancelada=1") && cancelar.destino.includes("reembolso=0"), "cancelar aplica la política heredada: se retiene el anticipo");
const final = await obtener(cancelar.destino);
comprobar(final.html.includes("Tu reserva fue cancelada"), "la página confirma la cancelación");
const penalizacion = await db.query("SELECT sum(a.monto_centavos)::int AS total FROM pagos.asientos a JOIN reservas.reservas r ON r.id = a.reserva_id WHERE r.codigo = $1 AND a.cuenta = 'ingreso_penalizacion'", [codigo]);
comprobar(penalizacion.rows[0].total < 0, "la penalización queda registrada como ingreso de WOPA");
await db.end();
console.log("Recorrido de pagos completo sin errores.");
