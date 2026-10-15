import type { Metadata } from "next";
import Link from "next/link";
import { listarExperiencias } from "@wopa/servicios";
import { diccionario } from "@/i18n";
import { dinero } from "@/lib/formato";

export async function generateMetadata({ params }: PageProps<"/[locale]/tours">): Promise<Metadata> {
  const { idioma } = diccionario((await params).locale);
  return { title: "Tours", alternates: { canonical: `/${idioma}/tours`, languages: { es: "/es/tours", en: "/en/tours" } } };
}

export default async function PaginaTours({ params }: PageProps<"/[locale]/tours">) {
  const { idioma } = diccionario((await params).locale);
  const es = idioma === "es";
  const tours = await listarExperiencias(idioma);
  return (
    <div className="contenedor pila" style={{ marginTop: 24 }}>
      <div>
        <h1>{es ? "Tours y experiencias" : "Tours and experiences"}</h1>
        <p className="suave">{es ? "Ideas para tu viaje. Te confirmamos operador, horarios y precio final antes de reservar." : "Ideas for your trip. We confirm the operator, schedule and final price before booking."}</p>
      </div>
      <div className="rejilla-3">
        {tours.map((tour) => (
          <article key={tour.codigo} className="tarjeta destino">
            <div className="foto" style={tour.imagen_url ? { backgroundImage: `url(${tour.imagen_url})` } : undefined} role="img" aria-label={tour.nombre} />
            <div className="texto pila" style={{ gap: 6 }}>
              <h2 style={{ fontSize: "1.1rem", margin: 0 }}>{tour.nombre}</h2>
              <span className="chico suave">{tour.ciudad}{tour.duracion ? ` · ${tour.duracion}` : ""}</span>
              <p className="chico" style={{ margin: 0 }}>{tour.descripcion}</p>
              <strong className="cifra">
                {tour.precio_centavos
                  ? `${dinero(tour.precio_centavos, tour.moneda, idioma)} ${tour.unidad_precio === "persona" ? (es ? "por persona" : "per person") : es ? "por grupo" : "per group"}`
                  : es ? "Precio a consultar" : "Price on request"}
              </strong>
              <Link className="boton secundario" href={`/${idioma}/cotizar?experiencia=${tour.codigo}`}>{es ? "Cotizar" : "Get a quote"}</Link>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
