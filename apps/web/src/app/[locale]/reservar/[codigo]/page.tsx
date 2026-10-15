import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { consultarReserva, pagosDeReserva } from "@wopa/servicios";
import { diccionario, mensajeError } from "@/i18n";
import { reservasConAcceso } from "@/lib/acceso-reservas";
import { dinero, fechaLarga } from "@/lib/formato";
import { cancelarReservaAccion } from "../../acciones";
import { SeccionPago } from "./SeccionPago";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PaginaReserva({ params, searchParams }: PageProps<"/[locale]/reservar/[codigo]">) {
  const { locale, codigo } = await params;
  const { t, idioma } = diccionario(locale);
  const parametros = await searchParams;
  const correo = (await reservasConAcceso())[codigo.toUpperCase()];
  if (!correo) redirect(`/${idioma}/mi-reserva`);
  const reserva = await consultarReserva(codigo, correo);
  if (!reserva) redirect(`/${idioma}/mi-reserva?error=RESERVA_NO_ENCONTRADA`);

  const error = mensajeError(t, parametros.error);
  const cancelable = ["retenida", "pendiente_pago", "solicitada", "confirmada"].includes(reserva.estado);
  const porPagar = ["retenida", "pendiente_pago"].includes(reserva.estado);
  const explicacion = t.reserva.explicacion[reserva.estado];
  const pagos = await pagosDeReserva(reserva.id);
  const ultimoPago = typeof parametros.pago === "string" ? pagos.find((p) => p.id === parametros.pago) : undefined;
  const procesando = ultimoPago?.estado === "pendiente" && porPagar;

  return (
    <div className="contenedor pila" style={{ marginTop: 24, maxWidth: 820 }}>
      <div>
        <p className="chico suave">{t.reserva.codigo}: <strong className="cifra">{reserva.codigo}</strong></p>
        <h1>{reserva.hotel}</h1>
        <span className={`etiqueta-estado e-${reserva.estado}`}>{t.reserva.estados[reserva.estado] ?? reserva.estado}</span>
      </div>
      {parametros.cancelada && (
        <p className="aviso exito" role="status">
          {t.reserva.cancelada} {BigInt(String(parametros.reembolso ?? "0")) > 0n && t.reserva.reembolso(dinero(String(parametros.reembolso), reserva.moneda, idioma))}
        </p>
      )}
      {error && <p className="aviso error" role="alert">{error}</p>}
      {procesando && <p className="aviso info" role="status">{t.reserva.procesando}</p>}
      {ultimoPago && ["fallido", "cancelado"].includes(ultimoPago.estado) && <p className="aviso error" role="alert">{t.reserva.pagoFallido}</p>}
      {explicacion && !procesando && <p className="aviso info">{explicacion}</p>}

      <div className="rejilla-2" style={{ alignItems: "start" }}>
        <section className="tarjeta pila">
          <div className="chico">
            <strong>{reserva.habitacion}</strong> · {t.reserva.huespedes(reserva.adultos)}<br />
            {fechaLarga(reserva.fecha_entrada, idioma)} → {fechaLarga(reserva.fecha_salida, idioma)}<br />
            {t.hotel.checkIn} {reserva.hora_check_in.slice(0, 5)} · {t.hotel.checkOut} {reserva.hora_check_out.slice(0, 5)}<br />
            {reserva.direccion}
          </div>
          <div className="resumen-pago cifra">
            <div className="linea"><span>{t.reserva.total}</span><span>{dinero(reserva.total, reserva.moneda, idioma)}</span></div>
            <div className="linea hoy"><span>{t.reserva.pagasHoy}</span><span>{dinero(reserva.anticipo, reserva.moneda, idioma)}</span></div>
            <div className="linea"><span>{t.reserva.pagasEnHotel}</span><span>{dinero(reserva.saldo, reserva.moneda, idioma)}</span></div>
          </div>
          <p className="chico" style={{ margin: 0 }}>{reserva.politica.descripcion}</p>
        </section>

        <section className="pila">
          {porPagar && (
            <SeccionPago
              codigo={reserva.codigo}
              correo={correo}
              idioma={idioma}
              t={t}
              retenidaHasta={reserva.retenida_hasta}
              montoCentavos={(BigInt(reserva.anticipo) - BigInt(reserva.pagado)).toString()}
              moneda={reserva.moneda}
            />
          )}
          <Link className="boton secundario" href={`/${idioma}/ayuda?reserva=${reserva.codigo}#contacto`}>{t.reserva.ayuda}</Link>
          {cancelable && (
            <details className="tarjeta">
              <summary>{t.reserva.cancelar}</summary>
              <form action={cancelarReservaAccion} className="pila" style={{ marginTop: 12 }}>
                <input type="hidden" name="idioma" value={idioma} />
                <input type="hidden" name="codigo" value={reserva.codigo} />
                <p className="chico">{reserva.politica.descripcion}</p>
                <button className="boton peligro" type="submit">{t.reserva.cancelarConfirmar}</button>
              </form>
            </details>
          )}
          {reserva.estado === "expirada" && <Link className="boton" href={`/${idioma}/hotel/${reserva.hotel_slug}`}>{t.reserva.volverABuscar}</Link>}
        </section>
      </div>
    </div>
  );
}
