import Link from "next/link";
import type { HotelResultado } from "@wopa/servicios";
import type { Diccionario } from "@/i18n/es";
import { dinero, type Idioma } from "@/lib/formato";

export function TarjetaHotel({ hotel, t, idioma, consulta }: { hotel: HotelResultado; t: Diccionario; idioma: Idioma; consulta: string }) {
  const opcion = hotel.mejorOpcion;
  const enlace = `/${idioma}/hotel/${hotel.slug}?${consulta}`;
  return (
    <article className="tarjeta resultado">
      <div className="foto" style={hotel.foto ? { backgroundImage: `url(${hotel.foto})` } : undefined} role="img" aria-label={hotel.nombre} />
      <div className="cuerpo pila" style={{ gap: 8 }}>
        <div>
          <h3 style={{ marginBottom: 2 }}><Link href={enlace}>{hotel.nombre}</Link></h3>
          <span className="suave chico">
            {[hotel.zona, hotel.ciudad].filter(Boolean).join(", ")}
            {hotel.categoria ? ` · ${t.resultados.estrellas(hotel.categoria)}` : ""}
          </span>
        </div>
        {hotel.servicios.length > 0 && (
          <ul className="servicios">{hotel.servicios.slice(0, 5).map((s) => <li key={s.codigo}>{s.nombre}</li>)}</ul>
        )}
        {opcion && <span className="chico">{opcion.habitacion}{opcion.incluyeDesayuno ? ` · ${t.hotel.desayuno}` : ""}</span>}
        {opcion?.modo === "solicitud" && <span className="chico suave">{t.resultados.bajoSolicitud}</span>}
      </div>
      <div className="precio">
        {opcion ? (
          <div>
            {!opcion.disponible && <p className="aviso advertencia chico">{t.resultados.agotado}</p>}
            <div className="chico suave">{t.resultados.total}</div>
            <div className="precio-total cifra">{dinero(opcion.totalCentavos, hotel.moneda, idioma)}</div>
            <div className="chico suave cifra">{dinero(opcion.porNocheCentavos, hotel.moneda, idioma)} {t.resultados.porNoche}</div>
            <div className="chico cifra" style={{ marginTop: 6 }}>
              {t.resultados.anticipoHoy}: <strong>{dinero(opcion.anticipoCentavos, hotel.moneda, idioma)}</strong>
            </div>
          </div>
        ) : (
          <p className="suave chico">{t.resultados.sinPrecio}</p>
        )}
        <Link className="boton" href={enlace}>{t.resultados.verHotel}</Link>
      </div>
    </article>
  );
}
