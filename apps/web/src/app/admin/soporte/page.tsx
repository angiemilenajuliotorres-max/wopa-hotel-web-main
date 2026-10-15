import Link from "next/link";
import { listarTickets } from "@wopa/servicios";
import { exigirWopa } from "@/lib/sesion";

const PRIORIDADES: Record<string, string> = { urgente: "Urgente", alta: "Alta", media: "Media", baja: "Baja" };
const ESTADOS: Record<string, string> = { abierto: "Abierto", en_progreso: "En progreso", esperando_cliente: "Esperando al cliente", resuelto: "Resuelto", cerrado: "Cerrado" };

export default async function PaginaSoporte({ searchParams }: PageProps<"/admin/soporte">) {
  const sesion = await exigirWopa();
  const { todos } = await searchParams;
  const tickets = await listarTickets(sesion, todos ? "todos" : "abiertos");
  const vencidos = tickets.filter((t) => t.vencido).length;
  return (
    <div className="pila">
      <div className="fila entre">
        <div>
          <h1>Soporte</h1>
          <p className="suave">{tickets.length} tickets {todos ? "en total" : "abiertos"}{vencidos ? ` · ${vencidos} fuera de plazo` : ""}</p>
        </div>
        <Link className="boton secundario" href={todos ? "/admin/soporte" : "/admin/soporte?todos=1"}>{todos ? "Solo abiertos" : "Ver todos"}</Link>
      </div>
      <div className="tabla-contenedor">
        <table>
          <thead><tr><th>Ticket</th><th>Asunto</th><th>Cliente</th><th>Prioridad</th><th>Estado</th><th>Responder antes de</th></tr></thead>
          <tbody>
            {tickets.length === 0 && <tr><td colSpan={6} className="suave">No hay tickets pendientes.</td></tr>}
            {tickets.map((t) => (
              <tr key={t.id}>
                <td className="cifra"><Link href={`/admin/soporte/${t.id}`}>{t.codigo}</Link></td>
                <td>{t.asunto}<br /><span className="chico suave">{t.categoria}{t.reserva ? ` · ${t.reserva}` : ""}</span></td>
                <td>{t.solicitante_nombre}<br /><span className="chico suave">{t.solicitante_correo}</span></td>
                <td><span className={`etiqueta-estado ${t.prioridad === "urgente" ? "e-cancelada" : t.prioridad === "alta" ? "e-abierto" : "e-en_progreso"}`}>{PRIORIDADES[t.prioridad]}</span></td>
                <td>{ESTADOS[t.estado] ?? t.estado}</td>
                <td className="cifra" style={t.vencido ? { color: "var(--error)", fontWeight: 600 } : undefined}>
                  {new Date(t.vence_sla_en).toLocaleString("es-PA", { timeZone: "America/Panama", dateStyle: "short", timeStyle: "short" })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
