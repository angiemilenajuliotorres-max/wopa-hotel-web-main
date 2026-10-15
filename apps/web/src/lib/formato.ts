export type Idioma = "es" | "en";

export function esIdioma(valor: string): valor is Idioma {
  return valor === "es" || valor === "en";
}

const LOCALES: Record<Idioma, string> = { es: "es-PA", en: "en-US" };

export function dinero(centavos: bigint | number | string, moneda: string, idioma: Idioma): string {
  const valor = Number(typeof centavos === "bigint" ? centavos : BigInt(centavos)) / 100;
  return new Intl.NumberFormat(LOCALES[idioma], { style: "currency", currency: moneda, maximumFractionDigits: valor % 1 === 0 ? 0 : 2 }).format(valor);
}

export function fechaCorta(fecha: string, idioma: Idioma): string {
  return new Date(`${fecha}T00:00:00Z`).toLocaleDateString(LOCALES[idioma], { day: "numeric", month: "short", timeZone: "UTC" });
}

export function fechaLarga(fecha: string, idioma: Idioma): string {
  return new Date(`${fecha}T00:00:00Z`).toLocaleDateString(LOCALES[idioma], { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function hoyMas(dias: number): string {
  return new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);
}

export function porcentaje(bp: number): string {
  return `${(bp / 100).toLocaleString("es-PA", { maximumFractionDigits: 2 })} %`;
}

/** Convierte un texto del formulario ("15", "15.5", "15,50") a centavos. */
export function aCentavos(texto: string): bigint {
  const limpio = texto.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) throw new Error("Monto inválido");
  const [enteros, decimales = ""] = limpio.split(".");
  return BigInt(enteros) * 100n + BigInt(decimales.padEnd(2, "0"));
}
