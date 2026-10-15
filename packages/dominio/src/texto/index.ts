/** Quita tildes y pasa a minúsculas: "Panamá " → "panama". */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

/** Identificador para URLs: "Hotel Casco Viejo" → "hotel-casco-viejo". */
export function crearSlug(texto: string): string {
  return normalizar(texto).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}
