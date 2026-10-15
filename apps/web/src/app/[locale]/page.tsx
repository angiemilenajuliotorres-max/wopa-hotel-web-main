import Link from "next/link";
import { destinosDestacados } from "@wopa/servicios";
import { Buscador } from "@/componentes/Buscador";
import { diccionario } from "@/i18n";
import { hoyMas } from "@/lib/formato";

export default async function Portada({ params }: PageProps<"/[locale]">) {
  const { t, idioma } = diccionario((await params).locale);
  const destinos = await destinosDestacados(idioma);
  return (
    <>
      <section className="portada">
        <div className="contenedor">
          <h1>{t.portada.titulo}</h1>
          <p>{t.portada.subtitulo}</p>
          <Buscador idioma={idioma} textos={t.buscador} hoy={hoyMas(0)} valores={{ destino: null, entrada: hoyMas(14), salida: hoyMas(16), huespedes: 2 }} />
        </div>
      </section>

      <section className="contenedor pila" style={{ marginTop: 32 }} aria-labelledby="titulo-destinos">
        <h2 id="titulo-destinos">{t.portada.destacados}</h2>
        <div className="rejilla-3">
          {destinos.map((destino) => (
            <Link key={destino.slug} href={`/${idioma}/destinos/${destino.slug}`} className="tarjeta destino">
              <div className="foto" style={destino.foto ? { backgroundImage: `url(${destino.foto})` } : undefined} role="img" aria-label={destino.nombre} />
              <div className="texto">
                <h3 style={{ margin: 0 }}>{destino.nombre}</h3>
                <span className="suave chico">{destino.pais} · {t.portada.hoteles(destino.hoteles)}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="contenedor" style={{ marginTop: 32 }}>
        <div className="confianza">
          {t.portada.confianza.map((punto) => (
            <div key={punto.titulo} className="tarjeta">
              <h3>{punto.titulo}</h3>
              <p className="suave" style={{ margin: 0 }}>{punto.texto}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
