import { listarCorreos } from "@wopa/servicios";
import { exigirWopa } from "@/lib/sesion";

export default async function PaginaCorreos() {
  await exigirWopa();
  const correos = await listarCorreos(100);
  return (
    <div className="pila">
      <div>
        <h1>Correos enviados</h1>
        <p className="suave">Mientras no haya cuenta de Resend (RESEND_API_KEY), los correos quedan “simulados” aquí para poder revisarlos.</p>
      </div>
      {correos.length === 0 && <p className="suave">Todavía no hay correos.</p>}
      {correos.map((c) => (
        <details key={c.id} className="tarjeta">
          <summary>
            <strong>{c.asunto}</strong> <span className="chico suave">· {c.para} · {c.plantilla} · {c.estado} · {new Date(c.creado_en).toLocaleString("es-PA", { timeZone: "America/Panama", dateStyle: "short", timeStyle: "short" })}</span>
          </summary>
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", marginTop: 12 }}>{c.cuerpo_texto}</pre>
        </details>
      ))}
    </div>
  );
}
