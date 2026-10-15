import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { describirPolitica } from "@wopa/dominio/reservas";
import { ErrorNegocio, fichaHotel, MINUTOS_RETENCION } from "@wopa/servicios";
import { diccionario, mensajeError } from "@/i18n";
import { consultaDe, criteriosDeUrl } from "@/lib/busqueda-url";
import { dinero, fechaLarga } from "@/lib/formato";
import { crearReservaAccion } from "../../acciones";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PaginaNuevaReserva({ params, searchParams }: PageProps<"/[locale]/reservar/nueva">) {
  const { t, idioma } = diccionario((await params).locale);
  const parametros = await searchParams;
  const criterios = criteriosDeUrl(parametros);
  const slug = String(parametros.hotel ?? "");
  const errorFormulario = mensajeError(t, parametros.error);

  let hotel: Awaited<ReturnType<typeof fichaHotel>> = null;
  let errorBusqueda: string | null = null;
  try {
    hotel = await fichaHotel(slug, idioma, { ...criterios, idioma });
  } catch (excepcion) {
    if (!(excepcion instanceof ErrorNegocio)) throw excepcion;
    errorBusqueda = mensajeError(t, excepcion.codigo);
    hotel = await fichaHotel(slug, idioma, null);
  }
  if (!hotel) notFound();
  const opcion = hotel.opciones.find((o) => o.tipoHabitacionId === parametros.habitacion && o.planTarifaId === parametros.plan);
  const volver = `/${idioma}/hotel/${hotel.slug}?${consultaDe(criterios)}`;

  if (!opcion || !opcion.disponible) {
    return (
      <div className="contenedor pila" style={{ marginTop: 24, maxWidth: 720 }}>
        <h1>{t.reserva.titulo}</h1>
        <p className="aviso advertencia">{errorBusqueda ?? t.errores.OPCION_NO_DISPONIBLE}</p>
        <Link className="boton" href={volver}>{hotel.nombre}</Link>
      </div>
    );
  }
  const noches = Math.round((Date.parse(criterios.salida) - Date.parse(criterios.entrada)) / 86_400_000);

  return (
    <div className="contenedor" style={{ marginTop: 24 }}>
      <h1>{t.reserva.titulo}</h1>
      <div className="rejilla-2" style={{ alignItems: "start" }}>
        <form action={crearReservaAccion} className="tarjeta pila">
          <h2>{t.reserva.tusDatos}</h2>
          {errorFormulario && <p className="aviso error" role="alert">{errorFormulario}</p>}
          <input type="hidden" name="idioma" value={idioma} />
          <input type="hidden" name="hotel" value={hotel.slug} />
          <input type="hidden" name="habitacion" value={opcion.tipoHabitacionId} />
          <input type="hidden" name="plan" value={opcion.planTarifaId} />
          <input type="hidden" name="entrada" value={criterios.entrada} />
          <input type="hidden" name="salida" value={criterios.salida} />
          <input type="hidden" name="huespedes" value={criterios.huespedes} />
          <div className="campo"><label htmlFor="nombre">{t.reserva.nombre}</label><input id="nombre" name="nombre" autoComplete="name" required minLength={2} /></div>
          <div className="campo">
            <label htmlFor="correo">{t.reserva.correo}</label>
            <input id="correo" name="correo" type="email" autoComplete="email" required aria-describedby="ayuda-correo" />
            <span id="ayuda-correo" className="ayuda">{t.reserva.correoAyuda}</span>
          </div>
          <div className="rejilla-2">
            <div className="campo"><label htmlFor="telefono">{t.reserva.telefono}</label><input id="telefono" name="telefono" type="tel" autoComplete="tel" required placeholder="+507 6000-0000" /></div>
            <div className="campo">
              <label htmlFor="pais">{t.reserva.pais}</label>
              <select id="pais" name="pais" defaultValue="PA">
                <option value="PA">{idioma === "es" ? "Panamá" : "Panama"}</option>
                <option value="CO">Colombia</option>
                <option value="">{idioma === "es" ? "Otro" : "Other"}</option>
              </select>
            </div>
          </div>
          <div className="campo"><label htmlFor="solicitudes">{t.reserva.solicitudes}</label><textarea id="solicitudes" name="solicitudes" maxLength={2000} /></div>
          <button className="boton dorado" type="submit">{opcion.modo === "solicitud" ? t.reserva.enviarSolicitud : t.reserva.continuar}</button>
          {opcion.modo === "anticipo_en_linea" && <p className="chico suave">{t.reserva.retenida(MINUTOS_RETENCION)}</p>}
        </form>

        <aside className="tarjeta pila" aria-labelledby="titulo-resumen">
          <h2 id="titulo-resumen">{t.reserva.resumen}</h2>
          <div>
            <strong>{hotel.nombre}</strong>
            <div className="chico suave">{opcion.habitacion} · {opcion.plan}</div>
          </div>
          <div className="chico">
            {fechaLarga(criterios.entrada, idioma)} → {fechaLarga(criterios.salida, idioma)}<br />
            {t.reserva.noches(noches)} · {t.reserva.huespedes(criterios.huespedes)}
          </div>
          <div className="resumen-pago cifra">
            <div className="linea"><span>{t.reserva.total}</span><span>{dinero(opcion.totalCentavos, hotel.moneda, idioma)}</span></div>
            <div className="linea hoy"><span>{t.reserva.pagasHoy}</span><span>{dinero(opcion.anticipoCentavos, hotel.moneda, idioma)}</span></div>
            <div className="linea"><span>{t.reserva.pagasEnHotel}</span><span>{dinero(opcion.saldoCentavos, hotel.moneda, idioma)}</span></div>
          </div>
          <p className="chico" style={{ color: "var(--exito)", margin: 0 }}>{describirPolitica(opcion.politica, criterios.entrada, idioma)}</p>
          {opcion.modo === "solicitud" && <p className="chico suave" style={{ margin: 0 }}>{t.resultados.bajoSolicitud}</p>}
        </aside>
      </div>
    </div>
  );
}
