import Link from "next/link";
import { notFound } from "next/navigation";
import { detalleTicket } from "@wopa/servicios";
import { mensajeDeError } from "@/lib/errores";
import { exigirWopa } from "@/lib/sesion";
import { responderTicketAccion } from "../../acciones";

export default async function PaginaTicket({ params, searchParams }: PageProps<"/admin/soporte/[id]">) {
  const sesion = await exigirWopa();
  const { id } = await params;
  const { error, ok } = await searchParams;
  const ticket = await detalleTicket(sesion, id);
  if (!ticket) notFound();
  const mensaje = mensajeDeError(error);
  return (
    <div className="pila" style={{ maxWidth: 820 }}>
      <p className="chico"><Link href="/admin/soporte">← Soporte</Link></p>
      <div>
        <h1>{ticket.codigo} · {ticket.asunto}</h1>
        <p className="suave">
          {ticket.solicitante_nombre} · {ticket.solicitante_correo}{ticket.solicitante_telefono ? ` · ${ticket.solicitante_telefono}` : ""}
          {ticket.reserva_codigo ? ` · reserva ${ticket.reserva_codigo}` : ""}{ticket.hotel ? ` · ${ticket.hotel}` : ""} · idioma {ticket.idioma_codigo}
        </p>
      </div>
      {mensaje && <p className="aviso error" role="alert">{mensaje}</p>}
      {ok && <p className="aviso exito" role="status">Respuesta guardada.</p>}
      <ol className="pila" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {ticket.mensajes.map((m, i) => (
          <li key={i} className="tarjeta" style={m.es_nota_interna ? { background: "var(--dorado-suave)" } : m.autor === "equipo" ? { background: "var(--azul-claro)" } : undefined}>
            <div className="chico suave">
              {m.autor === "cliente" ? "Cliente" : m.autor === "sistema" ? "Sistema" : `${m.nombre ?? "Equipo"}${m.es_nota_interna ? " · nota interna" : ""}`}
              {" · "}{new Date(m.creado_en).toLocaleString("es-PA", { timeZone: "America/Panama", dateStyle: "short", timeStyle: "short" })}
            </div>
            <div style={{ whiteSpace: "pre-wrap" }}>{m.contenido}</div>
          </li>
        ))}
      </ol>
      <form action={responderTicketAccion} className="tarjeta pila">
        <input type="hidden" name="ticketId" value={ticket.id} />
        <div className="campo">
          <label htmlFor="contenido">Respuesta (se envía por correo en el idioma del cliente: {ticket.idioma_codigo})</label>
          <textarea id="contenido" name="contenido" required minLength={2} />
        </div>
        <label className="fila chico"><input type="checkbox" name="notaInterna" /> Nota interna (no se envía al cliente)</label>
        <div className="campo">
          <label htmlFor="nuevoEstado">Estado después de responder</label>
          <select id="nuevoEstado" name="nuevoEstado" defaultValue="esperando_cliente">
            <option value="en_progreso">En progreso</option>
            <option value="esperando_cliente">Esperando al cliente</option>
            <option value="resuelto">Resuelto</option>
            <option value="cerrado">Cerrado</option>
          </select>
        </div>
        <div><button className="boton" type="submit">Guardar</button></div>
      </form>
    </div>
  );
}
