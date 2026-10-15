import { randomUUID } from "node:crypto";
import { opcionesParaReserva } from "@wopa/servicios";
import type { Diccionario } from "@/i18n/es";
import { dinero, type Idioma } from "@/lib/formato";
import { iniciarPagoAccion } from "../../acciones";

/** Métodos de pago disponibles para el país del viajero y del hotel (enrutador de pagos, ADR-006). */
export async function SeccionPago({
  codigo, correo, idioma, t, retenidaHasta, montoCentavos, moneda,
}: { codigo: string; correo: string; idioma: Idioma; t: Diccionario; retenidaHasta: Date | null; montoCentavos: string; moneda: string }) {
  const opciones = await opcionesParaReserva(codigo, correo);
  const hora = retenidaHasta
    ? new Date(retenidaHasta).toLocaleTimeString(idioma === "es" ? "es-PA" : "en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/Panama" })
    : null;
  return (
    <div className="tarjeta pila">
      <h2>{t.reserva.pago}</h2>
      {hora && <p className="chico">{t.reserva.plazo(hora)}</p>}
      {opciones.length === 0 && <p className="aviso info">{t.reserva.pagoProximamente}</p>}
      {opciones.map((opcion) => (
        <form key={opcion.metodo} action={iniciarPagoAccion}>
          <input type="hidden" name="idioma" value={idioma} />
          <input type="hidden" name="codigo" value={codigo} />
          <input type="hidden" name="metodo" value={opcion.metodo} />
          {/* Clave nueva en cada carga: si el navegador reenvía el formulario, no se cobra dos veces. */}
          <input type="hidden" name="claveIdempotencia" value={randomUUID()} />
          <button className="boton dorado" type="submit" style={{ width: "100%", justifyContent: "space-between" }}>
            <span>{t.reserva.metodos[opcion.metodo] ?? opcion.metodo}</span>
            <span className="cifra">{t.reserva.pagar(dinero(montoCentavos, moneda, idioma))}</span>
          </button>
        </form>
      ))}
      {opciones.length > 0 && <p className="chico suave" style={{ margin: 0 }}>{t.reserva.seguro}</p>}
    </div>
  );
}
