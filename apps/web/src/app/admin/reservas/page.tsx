import { listarReservasAdmin } from "@wopa/servicios";
import { mensajeDeError } from "@/lib/errores";
import { dinero } from "@/lib/formato";
import { exigirWopa } from "@/lib/sesion";
import { aceptarSolicitudAccion, rechazarSolicitudAccion } from "../acciones";

const ESTADOS: Record<string, string> = {
  retenida: "Retenida", pendiente_pago: "Pendiente de pago", solicitada: "Solicitud", confirmada: "Confirmada", rechazada: "Rechazada",
  expirada: "Expirada", cancelada: "Cancelada", completada: "Completada", no_show: "No se presentó",
};

export default async function PaginaReservas({ searchParams }: PageProps<"/admin/reservas">) {
  const sesion = await exigirWopa();
  const { estado, error, ok } = await searchParams;
  const reservas = await listarReservasAdmin(sesion, { estado: typeof estado === "string" && estado ? estado : undefined });
  const mensaje = mensajeDeError(error);
  return (
    <div className="pila">
      <div className="fila entre">
        <h1>Reservas</h1>
        <form className="fila" method="get">
          <div className="campo">
            <label htmlFor="estado" className="solo-lectores">Estado</label>
            <select id="estado" name="estado" defaultValue={typeof estado === "string" ? estado : ""}>
              <option value="">Todos los estados</option>
              {Object.entries(ESTADOS).map(([valor, nombre]) => <option key={valor} value={valor}>{nombre}</option>)}
            </select>
          </div>
          <button className="boton secundario" type="submit">Filtrar</button>
        </form>
      </div>
      {mensaje && <p className="aviso error" role="alert">{mensaje}</p>}
      {ok && <p className="aviso exito" role="status">Listo. Se avisó al viajero por correo.</p>}
      <div className="tabla-contenedor">
        <table>
          <thead><tr><th>Código</th><th>Hotel</th><th>Fechas</th><th>Titular</th><th>Total</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {reservas.length === 0 && <tr><td colSpan={7} className="suave">No hay reservas con ese filtro.</td></tr>}
            {reservas.map((r) => (
              <tr key={r.id}>
                <td className="cifra">{r.codigo}</td>
                <td>{r.hotel}</td>
                <td className="cifra">{r.fecha_entrada} → {r.fecha_salida}</td>
                <td>{r.titular_nombre}<br /><span className="chico suave">{r.titular_correo} · {r.titular_telefono}</span></td>
                <td className="cifra">{dinero(r.total, r.moneda, "es")}<br /><span className="chico suave">anticipo {dinero(r.anticipo, r.moneda, "es")}</span></td>
                <td><span className={`etiqueta-estado e-${r.estado}`}>{ESTADOS[r.estado] ?? r.estado}</span></td>
                <td>
                  {r.estado === "solicitada" && (
                    <div className="fila">
                      <form action={aceptarSolicitudAccion}><input type="hidden" name="reservaId" value={r.id} /><button className="boton" type="submit">Hay disponibilidad</button></form>
                      <form action={rechazarSolicitudAccion}><input type="hidden" name="reservaId" value={r.id} /><button className="boton secundario" type="submit">Sin disponibilidad</button></form>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
