import { randomInt } from "node:crypto";

export interface ReglaPolitica {
  diasAntesLlegada: number; // la regla aplica si se cancela con al menos estos días de anticipación
  penalizacionBp: number; // sobre el total de la estadía
}

/**
 * Penalización por cancelar. Aplica la regla con más días de anticipación que el huésped
 * todavía cumple; si cancela el día de llegada o después, aplica la de 0 días.
 * Nunca retiene más de lo pagado: lo que resta del pago se devuelve.
 */
export function calcularCancelacion(entrada: {
  reglas: readonly ReglaPolitica[];
  diasAntesLlegada: number;
  totalCentavos: bigint;
  pagadoCentavos: bigint;
}): { penalizacionCentavos: bigint; reembolsoCentavos: bigint; penalizacionBp: number } {
  const ordenadas = [...entrada.reglas].sort((a, b) => b.diasAntesLlegada - a.diasAntesLlegada);
  const dias = Math.max(entrada.diasAntesLlegada, 0);
  const regla = ordenadas.find((r) => dias >= r.diasAntesLlegada) ?? ordenadas.at(-1);
  const penalizacionBp = regla?.penalizacionBp ?? 0;
  const segunPolitica = (entrada.totalCentavos * BigInt(penalizacionBp) + 9_999n) / 10_000n;
  const penalizacionCentavos = segunPolitica < entrada.pagadoCentavos ? segunPolitica : entrada.pagadoCentavos;
  return { penalizacionCentavos, reembolsoCentavos: entrada.pagadoCentavos - penalizacionCentavos, penalizacionBp };
}

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

/** Frase de la política para mostrar al viajero. */
export function describirPolitica(reglas: readonly ReglaPolitica[], fechaEntrada: string, idioma: "es" | "en"): string {
  const gratis = [...reglas].filter((r) => r.penalizacionBp === 0).sort((a, b) => a.diasAntesLlegada - b.diasAntesLlegada)[0];
  if (!gratis) return idioma === "es" ? "No reembolsable: al cancelar se retiene lo pagado." : "Non-refundable: payments are kept if you cancel.";
  const limite = new Date(Date.parse(`${fechaEntrada}T00:00:00Z`) - gratis.diasAntesLlegada * 86_400_000);
  const fecha = limite.toLocaleDateString(idioma === "es" ? "es-PA" : "en-US", { day: "numeric", month: "short", timeZone: "UTC" });
  return idioma === "es" ? `Cancelación gratis hasta el ${fecha}` : `Free cancellation until ${fecha}`;
}

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin O/0 ni I/1, que se confunden al dictarlos

export function generarCodigoReserva(): string {
  let codigo = "WP-";
  for (let i = 0; i < 6; i++) codigo += ALFABETO[randomInt(ALFABETO.length)];
  return codigo;
}
