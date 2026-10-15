import { exigirSesion } from "@/lib/sesion";

export default async function PaginaExtranet() {
  const sesion = await exigirSesion();
  const hoteles = sesion.membresias.filter((m) => m.organizacionTipo === "hotel");
  return (
    <div className="pila">
      <h1>Hola, {sesion.usuario.nombre}</h1>
      {hoteles.length === 0 ? (
        <p className="aviso info">Tu cuenta no está asociada a ningún hotel. Escríbele a tu contacto en WOPA.</p>
      ) : (
        <ul className="pila" style={{ listStyle: "none", padding: 0 }}>
          {hoteles.map((h) => <li key={h.organizacionId} className="tarjeta">{h.organizacionNombre}</li>)}
        </ul>
      )}
      <p className="suave chico">La extranet completa (calendario de tarifas y cupos, reservas y liquidaciones) llega en la fase 5.</p>
    </div>
  );
}
