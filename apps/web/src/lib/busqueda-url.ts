import { hoyMas } from "./formato";

type Parametros = Record<string, string | string[] | undefined>;

function uno(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

/** Lee fechas y huéspedes de la URL, con valores por defecto razonables (dentro de 14 días, 2 noches, 2 personas). */
export function criteriosDeUrl(parametros: Parametros): { entrada: string; salida: string; huespedes: number; tieneFechas: boolean } {
  const entrada = uno(parametros.entrada);
  const salida = uno(parametros.salida);
  const huespedes = Number(uno(parametros.huespedes) ?? "2");
  const valida = (f?: string) => Boolean(f && /^\d{4}-\d{2}-\d{2}$/.test(f));
  return {
    entrada: valida(entrada) ? entrada! : hoyMas(14),
    salida: valida(salida) ? salida! : hoyMas(16),
    huespedes: Number.isInteger(huespedes) && huespedes >= 1 && huespedes <= 12 ? huespedes : 2,
    tieneFechas: valida(entrada) && valida(salida),
  };
}

export function consultaDe(criterios: { entrada: string; salida: string; huespedes: number }): string {
  return new URLSearchParams({ entrada: criterios.entrada, salida: criterios.salida, huespedes: String(criterios.huespedes) }).toString();
}
