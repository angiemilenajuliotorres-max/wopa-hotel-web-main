import { notFound } from "next/navigation";
import type { Idioma } from "@/lib/formato";
import { en } from "./en";
import { es, type Diccionario } from "./es";

export const IDIOMAS: Idioma[] = ["es", "en"];
const DICCIONARIOS: Record<Idioma, Diccionario> = { es, en };

/** Valida el segmento [locale] y devuelve su diccionario; cualquier otro valor es 404. */
export function diccionario(locale: string): { idioma: Idioma; t: Diccionario } {
  if (locale !== "es" && locale !== "en") notFound();
  return { idioma: locale, t: DICCIONARIOS[locale] };
}

export function mensajeError(t: Diccionario, codigo: string | string[] | undefined): string | null {
  if (!codigo || Array.isArray(codigo)) return null;
  return t.errores[codigo] ?? t.errores.ERROR_INESPERADO;
}
