import { resenasPendientes } from "@wopa/servicios";
import { mensajeDeError } from "@/lib/errores";
import { exigirWopa } from "@/lib/sesion";
import { moderarResenaAccion } from "../acciones";

export default async function PaginaResenas({ searchParams }: PageProps<"/admin/resenas">) {
  const sesion = await exigirWopa();
  const { error, ok } = await searchParams;
  const pendientes = await resenasPendientes(sesion);
  const mensaje = mensajeDeError(error);
  return (
    <div className="pila" style={{ maxWidth: 860 }}>
      <div>
        <h1>Reseñas por moderar</h1>
        <p className="suave">Solo llegan de huéspedes con estadía completada. Publica las auténticas aunque sean negativas; rechaza insultos, datos personales o contenido ajeno al hotel.</p>
      </div>
      {mensaje && <p className="aviso error" role="alert">{mensaje}</p>}
      {ok && <p className="aviso exito" role="status">Listo.</p>}
      {pendientes.length === 0 && <p className="suave">No hay reseñas pendientes.</p>}
      {pendientes.map((r) => (
        <article key={r.id} className="tarjeta pila">
          <strong>{r.hotel} · {"★".repeat(r.puntaje)}{"☆".repeat(5 - r.puntaje)} · {r.nombre_visible}</strong>
          {r.comentario && <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{r.comentario}</p>}
          <form action={moderarResenaAccion} className="fila">
            <input type="hidden" name="resenaId" value={r.id} />
            <button className="boton" name="accion" value="publicar" type="submit">Publicar</button>
            <button className="boton secundario" name="accion" value="rechazar" type="submit">Rechazar</button>
          </form>
        </article>
      ))}
    </div>
  );
}
