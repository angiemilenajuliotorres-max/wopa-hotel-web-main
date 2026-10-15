import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { describirPolitica } from "@wopa/dominio/reservas";
import { ErrorNegocio, fichaHotel, resenasDeHotel } from "@wopa/servicios";
import { diccionario, mensajeError } from "@/i18n";
import { consultaDe, criteriosDeUrl } from "@/lib/busqueda-url";
import { dinero, fechaCorta, hoyMas } from "@/lib/formato";

export async function generateMetadata({ params }: PageProps<"/[locale]/hotel/[slug]">): Promise<Metadata> {
  const { locale, slug } = await params;
  const { idioma } = diccionario(locale);
  const hotel = await fichaHotel(slug, idioma, null);
  if (!hotel) return {};
  return {
    title: `${hotel.nombre} · ${hotel.ciudad}`,
    description: hotel.descripcion?.slice(0, 160) ?? undefined,
    alternates: { canonical: `/${idioma}/hotel/${slug}`, languages: { es: `/es/hotel/${slug}`, en: `/en/hotel/${slug}` } },
    openGraph: hotel.fotos[0] ? { images: [hotel.fotos[0]] } : undefined,
  };
}

export default async function PaginaHotel({ params, searchParams }: PageProps<"/[locale]/hotel/[slug]">) {
  const { locale, slug } = await params;
  const { t, idioma } = diccionario(locale);
  const criterios = criteriosDeUrl(await searchParams);

  let hotel: Awaited<ReturnType<typeof fichaHotel>>;
  let error: string | null = null;
  try {
    hotel = await fichaHotel(slug, idioma, criterios.tieneFechas ? { ...criterios, idioma } : null);
  } catch (excepcion) {
    if (!(excepcion instanceof ErrorNegocio)) throw excepcion;
    error = mensajeError(t, excepcion.codigo);
    hotel = await fichaHotel(slug, idioma, null);
  }
  if (!hotel) notFound();
  const mapa = `https://www.google.com/maps/search/?api=1&query=${hotel.latitud},${hotel.longitud}`;
  const resenas = await resenasDeHotel(hotel.slug);

  // Datos estructurados para buscadores (schema.org/Hotel).
  const datosEstructurados = {
    "@context": "https://schema.org",
    "@type": "Hotel",
    name: hotel.nombre,
    address: { "@type": "PostalAddress", streetAddress: hotel.direccion, addressLocality: hotel.ciudad, addressCountry: hotel.pais },
    geo: { "@type": "GeoCoordinates", latitude: hotel.latitud, longitude: hotel.longitud },
    image: hotel.fotos,
    starRating: hotel.categoria ? { "@type": "Rating", ratingValue: hotel.categoria } : undefined,
    amenityFeature: hotel.servicios.map((s) => ({ "@type": "LocationFeatureSpecification", name: s.nombre, value: true })),
    aggregateRating: resenas.cantidad > 0 ? { "@type": "AggregateRating", ratingValue: resenas.promedio, reviewCount: resenas.cantidad, bestRating: 5 } : undefined,
  };

  return (
    <div className="contenedor pila" style={{ marginTop: 24 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(datosEstructurados).replace(/</g, "\\u003c") }} />
      <div>
        <p className="chico"><Link href={`/${idioma}/destinos/${hotel.ciudad_slug}`}>{hotel.ciudad}</Link> · {hotel.pais}</p>
        <h1>{hotel.nombre}</h1>
        <p className="suave">{[hotel.zona, hotel.direccion].filter(Boolean).join(" · ")}{hotel.categoria ? ` · ${t.resultados.estrellas(hotel.categoria)}` : ""}</p>
      </div>

      {hotel.fotos.length > 0 && (
        <div className="galeria">
          {hotel.fotos.slice(0, 5).map((foto, i) => (
            <div key={foto} style={{ backgroundImage: `url(${foto})` }} role="img" aria-label={`${hotel.nombre} ${i + 1}`} />
          ))}
        </div>
      )}

      <div className="rejilla-2" style={{ alignItems: "start" }}>
        <section className="pila">
          {hotel.descripcion && (
            <div className="pila" style={{ gap: 6 }}>
              {hotel.descripcion.split("\n").map((parrafo, i) => <p key={i}>{parrafo}</p>)}
              {!hotel.traduccion_disponible && idioma === "en" && <p className="chico suave">{t.hotel.traduccionPendiente}</p>}
            </div>
          )}
          {hotel.servicios.length > 0 && (
            <div>
              <h2>{t.hotel.servicios}</h2>
              <ul className="servicios">{hotel.servicios.map((s) => <li key={s.codigo}>{s.nombre}</li>)}</ul>
            </div>
          )}
          {resenas.cantidad > 0 && (
            <div className="pila" style={{ gap: 8 }}>
              <h2>{idioma === "es" ? "Opiniones de huéspedes" : "Guest reviews"} · {resenas.promedio}/5 ({resenas.cantidad})</h2>
              {resenas.ultimas.map((r, i) => (
                <blockquote key={i} className="tarjeta" style={{ margin: 0 }}>
                  <div className="chico">{"★".repeat(r.puntaje)}{"☆".repeat(5 - r.puntaje)} · {r.nombre_visible}</div>
                  {r.comentario && <p style={{ margin: "6px 0 0" }} lang={r.idioma}>{r.comentario}</p>}
                </blockquote>
              ))}
            </div>
          )}
          <div>
            <h2>{t.hotel.ubicacion}</h2>
            <p>{hotel.direccion}, {hotel.ciudad}</p>
            <p className="chico">{t.hotel.checkIn} {hotel.hora_check_in.slice(0, 5)} · {t.hotel.checkOut} {hotel.hora_check_out.slice(0, 5)}</p>
            <a href={mapa} target="_blank" rel="noopener noreferrer">{t.hotel.verMapa}</a>
          </div>
        </section>

        <section className="tarjeta pila" aria-labelledby="titulo-habitaciones">
          <h2 id="titulo-habitaciones">{t.hotel.habitaciones}</h2>
          <form className="rejilla-3" style={{ alignItems: "end" }} method="get">
            <div className="campo"><label htmlFor="entrada">{t.buscador.entrada}</label><input id="entrada" name="entrada" type="date" min={hoyMas(0)} defaultValue={criterios.entrada} required /></div>
            <div className="campo"><label htmlFor="salida">{t.buscador.salida}</label><input id="salida" name="salida" type="date" min={hoyMas(1)} defaultValue={criterios.salida} required /></div>
            <div className="campo">
              <label htmlFor="huespedes">{t.buscador.huespedes}</label>
              <select id="huespedes" name="huespedes" defaultValue={criterios.huespedes}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <button className="boton secundario" type="submit">{t.hotel.actualizar}</button>
          </form>
          {error && <p className="aviso error" role="alert">{error}</p>}
          {!criterios.tieneFechas && <p className="aviso info">{t.hotel.elegirFechas}</p>}
          {criterios.tieneFechas && !error && hotel.opciones.length === 0 && <p className="aviso info">{t.hotel.sinOpciones}</p>}
          {hotel.opciones.map((opcion) => {
            const reservar = new URLSearchParams({ hotel: hotel.slug, habitacion: opcion.tipoHabitacionId, plan: opcion.planTarifaId }).toString();
            return (
              <article key={`${opcion.tipoHabitacionId}-${opcion.planTarifaId}`} className="opcion" style={{ borderTop: "1px solid var(--borde)", paddingTop: 12 }}>
                <div className="pila" style={{ gap: 4 }}>
                  <h3 style={{ margin: 0 }}>{opcion.habitacion}</h3>
                  <span className="chico suave">{opcion.plan} · {t.hotel.capacidad(opcion.capacidad)}{opcion.incluyeDesayuno ? ` · ${t.hotel.desayuno}` : ""}</span>
                  <span className="chico" style={{ color: "var(--exito)" }}>{describirPolitica(opcion.politica, criterios.entrada, idioma)}</span>
                  {opcion.modo === "solicitud" && <span className="chico suave">{t.resultados.bajoSolicitud}</span>}
                </div>
                <div className="pila" style={{ gap: 4, textAlign: "right" }}>
                  <span className="precio-total cifra">{dinero(opcion.totalCentavos, hotel.moneda, idioma)}</span>
                  <span className="chico cifra">{t.resultados.anticipoHoy}: {dinero(opcion.anticipoCentavos, hotel.moneda, idioma)} · {t.resultados.enHotel}: {dinero(opcion.saldoCentavos, hotel.moneda, idioma)}</span>
                  {opcion.disponible ? (
                    <Link className="boton" href={`/${idioma}/reservar/nueva?${reservar}&${consultaDe(criterios)}`}>
                      {opcion.modo === "solicitud" ? t.hotel.solicitar : t.hotel.reservar}
                    </Link>
                  ) : (
                    <span className="aviso advertencia chico">{t.resultados.agotado}</span>
                  )}
                </div>
              </article>
            );
          })}
          {criterios.tieneFechas && <p className="chico suave">{fechaCorta(criterios.entrada, idioma)} → {fechaCorta(criterios.salida, idioma)} · {t.reserva.huespedes(criterios.huespedes)}</p>}
        </section>
      </div>
    </div>
  );
}
