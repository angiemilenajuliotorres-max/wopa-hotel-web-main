import { listarConversaciones, mensajesDeConversacion } from "@wopa/servicios";
import { exigirWopa } from "@/lib/sesion";

export default async function PaginaConversaciones({ searchParams }: PageProps<"/admin/conversaciones">) {
  await exigirWopa();
  const { id } = await searchParams;
  const conversaciones = await listarConversaciones(100);
  const elegida = typeof id === "string" ? await mensajesDeConversacion(id) : null;
  const valoradas = conversaciones.filter((c) => c.valoracion !== null);
  const promedio = valoradas.length ? (valoradas.reduce((s, c) => s + (c.valoracion ?? 0), 0) / valoradas.length).toFixed(1) : "—";
  const conTicket = conversaciones.filter((c) => c.ticket).length;

  return (
    <div className="pila">
      <div>
        <h1>Conversaciones del asistente</h1>
        <p className="suave">
          Últimas {conversaciones.length} · {conTicket} terminaron en ticket ({conversaciones.length ? Math.round((conTicket / conversaciones.length) * 100) : 0} %) · valoración promedio {promedio}
        </p>
        <p className="chico suave">Meta de la fase 4: que al menos 7 de cada 10 se resuelvan sin abrir un ticket.</p>
      </div>
      <div className="rejilla-2" style={{ alignItems: "start" }}>
        <div className="tabla-contenedor">
          <table>
            <thead><tr><th>Inicio</th><th>Primera pregunta</th><th>Resultado</th></tr></thead>
            <tbody>
              {conversaciones.length === 0 && <tr><td colSpan={3} className="suave">Todavía no hay conversaciones.</td></tr>}
              {conversaciones.map((c) => (
                <tr key={c.id}>
                  <td className="cifra"><a href={`/admin/conversaciones?id=${c.id}`}>{new Date(c.creado_en).toLocaleString("es-PA", { timeZone: "America/Panama", dateStyle: "short", timeStyle: "short" })}</a></td>
                  <td>{(c.primera ?? "").slice(0, 80)}<br /><span className="chico suave">{c.idioma} · {c.modo === "ia" ? "IA" : "sin IA"} · {c.mensajes} mensajes</span></td>
                  <td>{c.ticket ? <span className="etiqueta-estado e-abierto">{c.ticket}</span> : <span className="etiqueta-estado e-resuelto">Sin ticket</span>}{c.valoracion ? ` · ${c.valoracion}/5` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {elegida && (
          <section className="tarjeta pila" aria-label="Detalle de la conversación">
            {elegida.map((m, i) => (
              <div key={i} style={{ whiteSpace: "pre-wrap" }}>
                <div className="chico suave">{m.autor === "cliente" ? "Viajero" : m.autor === "asistente" ? "Asistente" : "Sistema"}</div>
                {m.contenido}
                {Boolean(m.herramientas) && <details className="chico"><summary>Herramientas usadas</summary><pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(m.herramientas, null, 2)}</pre></details>}
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
