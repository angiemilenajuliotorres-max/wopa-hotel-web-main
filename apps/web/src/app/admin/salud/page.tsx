import Link from "next/link";
import { listarRevisiones, saludHoteles } from "@wopa/servicios";
import { mensajeDeError } from "@/lib/errores";
import { exigirWopa } from "@/lib/sesion";
import { resolverRevisionAccion } from "../acciones";

const COLORES = { verde: "e-publicado", amarillo: "e-abierto", rojo: "e-cancelada" } as const;

export default async function PaginaSalud({ searchParams }: PageProps<"/admin/salud">) {
  const sesion = await exigirWopa();
  const { error, ok } = await searchParams;
  const [hoteles, revisiones] = await Promise.all([saludHoteles(sesion), listarRevisiones(sesion)]);
  const mensaje = mensajeDeError(error);
  return (
    <div className="pila">
      <h1>Supervisión de hoteles</h1>
      {mensaje && <p className="aviso error" role="alert">{mensaje}</p>}
      {ok && <p className="aviso exito" role="status">Listo.</p>}

      {revisiones.length > 0 && (
        <section className="tarjeta pila" aria-labelledby="titulo-revisiones">
          <h2 id="titulo-revisiones">Cambios de contenido por revisar</h2>
          {revisiones.map((r) => (
            <article key={r.id} className="pila" style={{ borderTop: "1px solid var(--borde)", paddingTop: 12 }}>
              <strong>{r.hotel} · descripción en {r.cambios.idioma === "es" ? "español" : "inglés"} · propuesto por {r.solicitado_por}</strong>
              <div className="rejilla-2">
                <div><div className="chico suave">Antes</div><p style={{ whiteSpace: "pre-wrap" }}>{r.cambios.antes?.descripcion ?? "(sin texto)"}</p></div>
                <div><div className="chico suave">Después</div><p style={{ whiteSpace: "pre-wrap" }}>{r.cambios.despues.descripcion}</p></div>
              </div>
              <form action={resolverRevisionAccion} className="fila">
                <input type="hidden" name="revisionId" value={r.id} />
                <label htmlFor={`com-${r.id}`} className="solo-lectores">Comentario</label>
                <input id={`com-${r.id}`} name="comentario" placeholder="Comentario (opcional)" />
                <button className="boton" name="accion" value="aprobar" type="submit">Aprobar y publicar</button>
                <button className="boton secundario" name="accion" value="rechazar" type="submit">Rechazar</button>
              </form>
            </article>
          ))}
        </section>
      )}

      <div className="tabla-contenedor">
        <table>
          <thead><tr><th>Hotel</th><th>Salud</th><th>Motivos</th></tr></thead>
          <tbody>
            {hoteles.map((h) => (
              <tr key={h.id}>
                <td><Link href={`/admin/hoteles/${h.id}`}>{h.nombre}</Link></td>
                <td><span className={`etiqueta-estado ${COLORES[h.semaforo]}`}>{h.semaforo}</span></td>
                <td className="chico">{h.motivos.length ? h.motivos.join(" · ") : "Sin observaciones"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
