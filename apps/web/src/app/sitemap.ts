import type { MetadataRoute } from "next";
import { obtenerPool } from "@wopa/servicios";

export const dynamic = "force-dynamic";

/** Portada, ayuda, destinos y fichas de hotel publicadas, en es y en con sus alternativas. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.URL_PUBLICA ?? "http://localhost:3100";
  const pool = obtenerPool();
  const ciudades = (await pool.query<{ slug: string }>(
    "SELECT DISTINCT t.slug FROM geo.ciudad_traducciones t JOIN geo.ciudades c ON c.id = t.ciudad_id WHERE c.esta_activa AND t.idioma_codigo = 'es'",
  )).rows;
  const hoteles = (await pool.query<{ slug: string; actualizado_en: Date }>(
    "SELECT slug, actualizado_en FROM catalogo.hoteles WHERE estado = 'publicado' AND eliminado_en IS NULL",
  )).rows;
  const entrada = (ruta: string, modificado?: Date): MetadataRoute.Sitemap[number] => ({
    url: `${base}/es${ruta}`,
    lastModified: modificado,
    alternates: { languages: { es: `${base}/es${ruta}`, en: `${base}/en${ruta}` } },
  });
  return [
    entrada(""),
    entrada("/ayuda"),
    ...ciudades.map((c) => entrada(`/destinos/${c.slug}`)),
    ...hoteles.map((h) => entrada(`/hotel/${h.slug}`, h.actualizado_en)),
  ];
}
