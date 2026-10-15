import type { Metadata } from "next";
import { listarExperiencias, obtenerCotizacion, obtenerPool } from "@wopa/servicios";
import { diccionario, mensajeError } from "@/i18n";
import { dinero, hoyMas } from "@/lib/formato";
import { crearCotizacionAccion } from "../acciones";

export const metadata: Metadata = { robots: { index: false, follow: true } };

export default async function PaginaCotizar({ params, searchParams }: PageProps<"/[locale]/cotizar">) {
  const { t, idioma } = diccionario((await params).locale);
  const es = idioma === "es";
  const parametros = await searchParams;
  const error = mensajeError(t, parametros.error);
  const cotizacion = typeof parametros.codigo === "string" ? await obtenerCotizacion(parametros.codigo) : null;
  const [tours, hoteles] = await Promise.all([
    listarExperiencias(idioma),
    obtenerPool().query<{ slug: string; nombre: string }>("SELECT slug, nombre FROM catalogo.hoteles WHERE estado = 'publicado' AND eliminado_en IS NULL ORDER BY nombre"),
  ]);

  return (
    <div className="contenedor pila" style={{ marginTop: 24, maxWidth: 820 }}>
      <h1>{es ? "Cotiza tu viaje" : "Get a quote"}</h1>
      <p className="suave">{es ? "Combina hospedaje y tours. Te mostramos un total estimado al instante y puedes descargarlo en PDF." : "Combine hotels and tours. See an instant estimated total and download it as a PDF."}</p>

      {cotizacion && (
        <section className="tarjeta pila" aria-live="polite">
          <h2>{es ? "Tu cotización" : "Your quote"} {cotizacion.codigo}</h2>
          <div className="resumen-pago cifra">
            {cotizacion.lineas.map((l, i) => (
              <div key={i} className="linea"><span>{l.descripcion}</span><span>{l.monto_centavos === null ? (es ? "A confirmar" : "To be confirmed") : dinero(l.monto_centavos, "USD", idioma)}</span></div>
            ))}
            <div className="linea hoy"><span>{es ? "Total estimado" : "Estimated total"}{cotizacion.parcial ? (es ? " (parcial)" : " (partial)") : ""}</span><span>{dinero(cotizacion.totalCentavos, "USD", idioma)}</span></div>
          </div>
          <a className="boton" href={`/api/v1/cotizaciones/${cotizacion.codigo}/pdf`}>{es ? "Descargar PDF" : "Download PDF"}</a>
        </section>
      )}

      <form action={crearCotizacionAccion} className="tarjeta pila">
        {error && <p className="aviso error" role="alert">{error}</p>}
        <input type="hidden" name="idioma" value={idioma} />
        <div className="rejilla-2">
          <div className="campo">
            <label htmlFor="hotel">{es ? "Hotel (opcional)" : "Hotel (optional)"}</label>
            <select id="hotel" name="hotel" defaultValue={typeof parametros.hotel === "string" ? parametros.hotel : ""}>
              <option value="">{es ? "Sin hospedaje" : "No hotel"}</option>
              {hoteles.rows.map((h) => <option key={h.slug} value={h.slug}>{h.nombre}</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="experiencia">{es ? "Tour (opcional)" : "Tour (optional)"}</label>
            <select id="experiencia" name="experiencia" defaultValue={typeof parametros.experiencia === "string" ? parametros.experiencia : ""}>
              <option value="">{es ? "Sin tour" : "No tour"}</option>
              {tours.map((tour) => <option key={tour.codigo} value={tour.codigo}>{tour.nombre}</option>)}
            </select>
          </div>
        </div>
        <div className="rejilla-3">
          <div className="campo"><label htmlFor="entrada">{t.buscador.entrada}</label><input id="entrada" name="entrada" type="date" min={hoyMas(0)} defaultValue={hoyMas(14)} /></div>
          <div className="campo"><label htmlFor="salida">{t.buscador.salida}</label><input id="salida" name="salida" type="date" min={hoyMas(1)} defaultValue={hoyMas(16)} /></div>
          <div className="campo"><label htmlFor="personas">{es ? "Personas" : "Guests"}</label><input id="personas" name="personas" type="number" min={1} max={50} defaultValue={2} required /></div>
        </div>
        <div className="rejilla-3">
          <div className="campo"><label htmlFor="nombre">{t.reserva.nombre}</label><input id="nombre" name="nombre" autoComplete="name" required /></div>
          <div className="campo"><label htmlFor="correo">{t.reserva.correo}</label><input id="correo" name="correo" type="email" autoComplete="email" required /></div>
          <div className="campo"><label htmlFor="telefono">{t.reserva.telefono}</label><input id="telefono" name="telefono" type="tel" autoComplete="tel" required /></div>
        </div>
        <div className="campo"><label htmlFor="notas">{es ? "Notas (opcional)" : "Notes (optional)"}</label><textarea id="notas" name="notas" maxLength={2000} /></div>
        <button className="boton dorado" type="submit">{es ? "Ver cotización" : "See quote"}</button>
      </form>
    </div>
  );
}
