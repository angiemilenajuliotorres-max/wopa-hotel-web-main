import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buscarHoteles } from "@wopa/servicios";
import { Buscador } from "@/componentes/Buscador";
import { TarjetaHotel } from "@/componentes/TarjetaHotel";
import { diccionario } from "@/i18n";
import { consultaDe } from "@/lib/busqueda-url";
import { fechaCorta, hoyMas } from "@/lib/formato";

async function cargar(locale: string, ciudad: string) {
  const { t, idioma } = diccionario(locale);
  // Página de destino (SEO): precios de referencia para 2 personas, 2 noches, dentro de 14 días.
  const criterios = { entrada: hoyMas(14), salida: hoyMas(16), huespedes: 2 };
  const resultado = await buscarHoteles({ tipo: "ciudad", slug: ciudad }, { ...criterios, idioma });
  if (!resultado.destino) notFound();
  return { t, idioma, criterios, resultado };
}

export async function generateMetadata({ params }: PageProps<"/[locale]/destinos/[ciudad]">): Promise<Metadata> {
  const { locale, ciudad } = await params;
  const { t, resultado, idioma } = await cargar(locale, ciudad);
  const nombre = resultado.destino!.nombre;
  return {
    title: t.resultados.titulo(nombre),
    description: `${t.resultados.titulo(nombre)}, ${resultado.destino!.pais}. ${t.meta.descripcion}`,
    alternates: { canonical: `/${idioma}/destinos/${ciudad}`, languages: { es: `/es/destinos/${ciudad}`, en: `/en/destinos/${ciudad}` } },
  };
}

export default async function PaginaDestino({ params }: PageProps<"/[locale]/destinos/[ciudad]">) {
  const { locale, ciudad } = await params;
  const { t, idioma, criterios, resultado } = await cargar(locale, ciudad);
  const nombre = resultado.destino!.nombre;
  return (
    <div className="contenedor pila" style={{ marginTop: 24 }}>
      <div>
        <h1>{t.resultados.titulo(nombre)}</h1>
        <p className="suave">{resultado.destino!.pais}</p>
      </div>
      <Buscador idioma={idioma} textos={t.buscador} hoy={hoyMas(0)} valores={{ destino: { tipo: "ciudad", slug: ciudad, nombre }, ...criterios }} />
      <p className="suave chico">{t.resultados.referencia(fechaCorta(criterios.entrada, idioma))}</p>
      {resultado.hoteles.length === 0 && <p className="aviso info">{t.resultados.sinHoteles}</p>}
      {resultado.hoteles.map((hotel) => (
        <TarjetaHotel key={hotel.id} hotel={hotel} t={t} idioma={idioma} consulta={consultaDe(criterios)} />
      ))}
    </div>
  );
}
