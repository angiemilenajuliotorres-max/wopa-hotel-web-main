/**
 * Cálculo del precio al público, el anticipo y el reparto entre WOPA y el hotel.
 *
 * Reglas (docs/arquitectura/04-precios-y-pagos.md, ADR-007 y ADR-008):
 *   venta por noche = neta + margen, redondeada hacia arriba al múltiplo de la moneda;
 *                     el redondeo se suma al margen.
 *   anticipo        = máx(anticipo_bp × venta total, margen total), sin superar la venta.
 *   saldo           = venta − anticipo (lo cobra el hotel al llegar el huésped).
 *   liquidación     = anticipo − margen (lo que WOPA transfiere al hotel).
 *
 * Todo el dinero va en centavos (bigint) de la moneda del hotel.
 */

export const BASE_PUNTOS = 10_000n; // 10.000 puntos básicos = 100 %

export type ReglaMargen =
  | { tipo: "porcentaje"; porcentajeBp: number }
  | { tipo: "monto_fijo"; montoCentavos: bigint };

export interface ReglaMargenVigente {
  id: string;
  planTarifaId: string | null; // null = aplica a todos los planes del hotel
  vigenteDesde: string; // YYYY-MM-DD
  vigenteHasta: string | null; // YYYY-MM-DD inclusive; null = sin fin
  regla: ReglaMargen;
}

export interface Noche {
  fecha: string; // YYYY-MM-DD
  netoCentavos: bigint;
  margenCentavos: bigint;
  ventaCentavos: bigint;
  reglaMargenId: string;
}

export interface Estadia {
  noches: Noche[];
  totalNetoCentavos: bigint;
  totalMargenCentavos: bigint;
  totalVentaCentavos: bigint;
  anticipoCentavos: bigint;
  saldoCentavos: bigint;
  liquidacionHotelCentavos: bigint;
}

export class SinMargenVigente extends Error {
  readonly fecha: string;
  constructor(fecha: string) {
    super(`El hotel no tiene un margen vigente para el ${fecha}.`);
    this.name = "SinMargenVigente";
    this.fecha = fecha;
  }
}

export class DatoInvalido extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "DatoInvalido";
  }
}

/** División entera redondeando hacia arriba, para valores no negativos. */
function dividirHaciaArriba(dividendo: bigint, divisor: bigint): bigint {
  return (dividendo + divisor - 1n) / divisor;
}

function validarPuntosBasicos(valor: number, campo: string): bigint {
  if (!Number.isInteger(valor) || valor < 0 || valor > Number(BASE_PUNTOS)) {
    throw new DatoInvalido(`${campo} debe ser un entero entre 0 y ${BASE_PUNTOS}.`);
  }
  return BigInt(valor);
}

/**
 * Precio de una noche. El margen se redondea hacia arriba para que WOPA nunca
 * cobre menos de lo configurado y la venta quede en un múltiplo de `redondeoCentavos`.
 */
export function calcularNoche(
  netoCentavos: bigint,
  regla: ReglaMargen,
  redondeoCentavos: bigint,
): { netoCentavos: bigint; margenCentavos: bigint; ventaCentavos: bigint } {
  if (netoCentavos <= 0n) throw new DatoInvalido("La tarifa neta debe ser mayor que cero.");
  if (redondeoCentavos <= 0n) throw new DatoInvalido("El redondeo debe ser mayor que cero.");

  let margenBase: bigint;
  if (regla.tipo === "porcentaje") {
    const puntos = validarPuntosBasicos(regla.porcentajeBp, "porcentajeBp");
    margenBase = dividirHaciaArriba(netoCentavos * puntos, BASE_PUNTOS);
  } else {
    if (regla.montoCentavos < 0n) throw new DatoInvalido("El margen fijo no puede ser negativo.");
    margenBase = regla.montoCentavos;
  }

  const ventaCentavos = dividirHaciaArriba(netoCentavos + margenBase, redondeoCentavos) * redondeoCentavos;
  return { netoCentavos, margenCentavos: ventaCentavos - netoCentavos, ventaCentavos };
}

function estaVigente(regla: ReglaMargenVigente, fecha: string): boolean {
  return regla.vigenteDesde <= fecha && (regla.vigenteHasta === null || fecha <= regla.vigenteHasta);
}

/**
 * Regla aplicable a una noche: la del plan, si existe y está vigente; si no, la del hotel.
 * No existe un margen global: sin regla, la noche no se puede vender.
 */
export function seleccionarReglaMargen(
  reglas: readonly ReglaMargenVigente[],
  fecha: string,
  planTarifaId: string,
): ReglaMargenVigente {
  const vigentes = reglas.filter((regla) => estaVigente(regla, fecha));
  const delPlan = vigentes.find((regla) => regla.planTarifaId === planTarifaId);
  const delHotel = vigentes.find((regla) => regla.planTarifaId === null);
  const elegida = delPlan ?? delHotel;
  if (!elegida) throw new SinMargenVigente(fecha);
  return elegida;
}

/** Estadía completa: precio por noche, totales, anticipo, saldo y liquidación al hotel. */
export function calcularEstadia(entrada: {
  noches: readonly { fecha: string; netoCentavos: bigint }[];
  planTarifaId: string;
  reglasMargen: readonly ReglaMargenVigente[];
  anticipoBp: number;
  redondeoCentavos: bigint;
}): Estadia {
  if (entrada.noches.length === 0) throw new DatoInvalido("La estadía debe tener al menos una noche.");
  const anticipoPuntos = validarPuntosBasicos(entrada.anticipoBp, "anticipoBp");

  const noches: Noche[] = entrada.noches.map(({ fecha, netoCentavos }) => {
    const regla = seleccionarReglaMargen(entrada.reglasMargen, fecha, entrada.planTarifaId);
    return { fecha, reglaMargenId: regla.id, ...calcularNoche(netoCentavos, regla.regla, entrada.redondeoCentavos) };
  });

  const sumar = (campo: "netoCentavos" | "margenCentavos" | "ventaCentavos") =>
    noches.reduce((total, noche) => total + noche[campo], 0n);
  const totalNetoCentavos = sumar("netoCentavos");
  const totalMargenCentavos = sumar("margenCentavos");
  const totalVentaCentavos = sumar("ventaCentavos");

  const anticipoPorcentaje = dividirHaciaArriba(totalVentaCentavos * anticipoPuntos, BASE_PUNTOS);
  const anticipoMinimo = anticipoPorcentaje > totalMargenCentavos ? anticipoPorcentaje : totalMargenCentavos;
  const anticipoCentavos = anticipoMinimo > totalVentaCentavos ? totalVentaCentavos : anticipoMinimo;

  return {
    noches,
    totalNetoCentavos,
    totalMargenCentavos,
    totalVentaCentavos,
    anticipoCentavos,
    saldoCentavos: totalVentaCentavos - anticipoCentavos,
    liquidacionHotelCentavos: anticipoCentavos - totalMargenCentavos,
  };
}
