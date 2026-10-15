import Link from "next/link";
import { alertasAbiertas, listarHotelesAdmin } from "@wopa/servicios";
import { dinero, porcentaje } from "@/lib/formato";
import { exigirWopa } from "@/lib/sesion";
import { atenderAlertaAccion } from "./acciones";

const ESTADOS: Record<string, string> = { borrador: "Borrador", en_revision: "En revisión", publicado: "Publicado", suspendido: "Suspendido" };
const ALERTAS: Record<string, string> = {
  precio_anomalo: "Cambio de precio fuera de lo normal",
  sin_cupo_prolongado: "Muchos días seguidos sin cupo",
  ticket_urgente_vencido: "Ticket urgente sin atender",
  monto_pago_no_coincide: "Monto de pago distinto al esperado",
  pago_pendiente_vencido: "Pago pendiente sin respuesta del proveedor",
  traducciones_faltantes: "Faltan traducciones",
  otra: "Otra",
};

export default async function PaginaHoteles() {
  const sesion = await exigirWopa();
  const [hoteles, alertas] = await Promise.all([listarHotelesAdmin(sesion), alertasAbiertas(sesion)]);
  const porRevisar = hoteles.filter((h) => h.estado === "en_revision" || h.estado === "borrador").length;

  return (
    <div className="pila">
      <div className="fila entre">
        <div>
          <h1>Hoteles</h1>
          <p className="suave">{hoteles.length} hoteles · {porRevisar} por aceptar · {alertas.length} alertas abiertas</p>
        </div>
        <Link className="boton" href="/admin/hoteles/nuevo">Nuevo hotel</Link>
      </div>

      {alertas.length > 0 && (
        <section className="tarjeta pila" aria-labelledby="titulo-alertas">
          <h2 id="titulo-alertas">Alertas de supervisión</h2>
          <div className="tabla-contenedor">
            <table>
              <thead><tr><th>Alerta</th><th>Hotel</th><th>Detalle</th><th></th></tr></thead>
              <tbody>
                {alertas.map((alerta) => (
                  <tr key={alerta.id}>
                    <td><span className={`etiqueta-estado ${alerta.severidad === "critica" ? "e-cancelada" : "e-abierto"}`}>{ALERTAS[alerta.tipo] ?? alerta.tipo}</span></td>
                    <td>{alerta.hotel_id ? <Link href={`/admin/hoteles/${alerta.hotel_id}`}>{alerta.hotel}</Link> : "—"}</td>
                    <td className="chico suave">
                      {alerta.tipo === "precio_anomalo"
                        ? `Neta ${dinero(String(alerta.detalle.nuevoCentavos), "USD", "es")} frente a un promedio de ${dinero(String(alerta.detalle.promedioCentavos), "USD", "es")} (${alerta.detalle.variacionPct} %) desde ${alerta.detalle.desde}`
                        : JSON.stringify(alerta.detalle)}
                    </td>
                    <td>
                      <form action={atenderAlertaAccion} className="fila">
                        <input type="hidden" name="alertaId" value={alerta.id} />
                        <button className="boton secundario" name="accion" value="atender">Atendida</button>
                        <button className="boton secundario" name="accion" value="descartar">Descartar</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="tabla-contenedor">
        <table>
          <thead><tr><th>Hotel</th><th>Ciudad</th><th>Estado</th><th>Modo</th><th>Margen vigente</th><th>Alertas</th></tr></thead>
          <tbody>
            {hoteles.length === 0 && (
              <tr><td colSpan={6} className="suave">Aún no hay hoteles. Crea el primero con “Nuevo hotel” o importa los de la web actual con <code>npm run db:importar-legado</code>.</td></tr>
            )}
            {hoteles.map((hotel) => (
              <tr key={hotel.id}>
                <td><Link href={`/admin/hoteles/${hotel.id}`}>{hotel.nombre}</Link></td>
                <td>{hotel.ciudad} · {hotel.pais}</td>
                <td><span className={`etiqueta-estado e-${hotel.estado}`}>{ESTADOS[hotel.estado] ?? hotel.estado}</span></td>
                <td>{hotel.modo_reserva === "solicitud" ? "Bajo solicitud" : "Anticipo en línea"}</td>
                <td className="cifra">
                  {hotel.margen_tipo === "porcentaje" && porcentaje(hotel.margen_porcentaje_bp!)}
                  {hotel.margen_tipo === "monto_fijo" && `${dinero(hotel.margen_monto_centavos!, "USD", "es")} por noche`}
                  {!hotel.margen_tipo && <span className="suave">Sin margen</span>}
                </td>
                <td className="cifra">{hotel.alertas_abiertas || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
