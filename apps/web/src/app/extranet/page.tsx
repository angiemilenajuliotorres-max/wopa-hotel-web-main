import Link from "next/link";
import { hotelesDeSesion } from "@wopa/servicios";
import { exigirSesion } from "@/lib/sesion";

export default async function PaginaExtranet() {
  const sesion = await exigirSesion();
  const hoteles = await hotelesDeSesion(sesion);
  return (
    <div className="pila">
      <h1>Hola, {sesion.usuario.nombre}</h1>
      {hoteles.length === 0 ? (
        <p className="aviso info">Tu cuenta no está asociada a ningún hotel. Escríbele a tu contacto en WOPA.</p>
      ) : (
        <div className="rejilla-3">
          {hoteles.map((h) => (
            <Link key={h.id} href={`/extranet/hoteles/${h.id}`} className="tarjeta" style={{ textDecoration: "none", color: "inherit" }}>
              <h2 style={{ fontSize: "1.15rem" }}>{h.nombre}</h2>
              <p className="suave chico" style={{ margin: 0 }}>
                {h.ciudad} · <span className={`etiqueta-estado e-${h.estado}`}>{h.estado.replace("_", " ")}</span> · {h.modo_reserva === "solicitud" ? "Bajo solicitud" : "Anticipo en línea"}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
