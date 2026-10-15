import type { Metadata } from "next";
import { buscarHoteles, ErrorNegocio } from "@wopa/servicios";
import { Buscador } from "@/componentes/Buscador";
import { TarjetaHotel } from "@/componentes/TarjetaHotel";
import { diccionario, mensajeError } from "@/i18n";
import { consultaDe, criteriosDeUrl } from "@/lib/busqueda-url";
import { hoyMas } from "@/lib/formato";

export const metadata: Metadata = { robots: { index: false, follow: true } };

export default async function PaginaBuscar({ params, searchParams }: PageProps<"/[locale]/buscar">) {
  const { t, idioma } = diccionario((await params).locale);
  const parametros = await searchParams;
  const criterios = criteriosDeUrl(parametros);
  const [tipo, slug] = String(parametros.destino ?? "").split(":");
  const destinoValido = (tipo === "ciudad" || tipo === "pais") && Boolean(slug);

  let resultado: Awaited<ReturnType<typeof buscarHoteles>> | null = null;
  let error: string | null = null;
  if (destinoValido) {
    try {
      resultado = await buscarHoteles({ tipo: tipo as "ciudad" | "pais", slug }, { ...criterios, idioma });
    } catch (excepcion) {
      if (!(excepcion instanceof ErrorNegocio)) throw excepcion;
      error = mensajeError(t, excepcion.codigo);
    }
  }
  const nombreDestino = resultado?.destino?.nombre ?? "";

  return (
    <div className="contenedor pila" style={{ marginTop: 24 }}>
      <Buscador
        idioma={idioma}
        textos={t.buscador}
        hoy={hoyMas(0)}
        valores={{ destino: destinoValido && nombreDestino ? { tipo: tipo as "ciudad" | "pais", slug, nombre: nombreDestino } : null, ...criterios }}
      />
      {error && <p className="aviso error" role="alert">{error}</p>}
      {resultado && (
        <section className="pila" aria-live="polite">
          <div>
            <h1>{t.resultados.titulo(nombreDestino)}</h1>
            <p className="suave">{t.resultados.resumen(resultado.noches, criterios.huespedes)}</p>
          </div>
          {resultado.hoteles.length === 0 && <p className="aviso info">{t.resultados.sinHoteles}</p>}
          {resultado.hoteles.map((hotel) => (
            <TarjetaHotel key={hotel.id} hotel={hotel} t={t} idioma={idioma} consulta={consultaDe(criterios)} />
          ))}
        </section>
      )}
    </div>
  );
}
