import type { Diccionario } from "@/i18n/es";
import type { Idioma } from "@/lib/formato";

/** Fase 2: muestra el plazo. La fase 3 reemplaza este bloque por los métodos de pago del país. */
export async function SeccionPago({ t, retenidaHasta, idioma }: { codigo: string; idioma: Idioma; t: Diccionario; retenidaHasta: Date | null }) {
  const hasta = retenidaHasta
    ? new Date(retenidaHasta).toLocaleTimeString(idioma === "es" ? "es-PA" : "en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/Panama" })
    : null;
  return (
    <div className="tarjeta pila">
      <h2>{t.reserva.pago}</h2>
      {hasta && <p className="chico">{idioma === "es" ? `Plazo para pagar: hasta las ${hasta} (hora de Panamá).` : `Pay by ${hasta} (Panama time).`}</p>}
      <p className="aviso info">{t.reserva.pagoProximamente}</p>
    </div>
  );
}
