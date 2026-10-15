import type { Idioma } from "./busqueda.ts";
import { db, type Consulta } from "./conexion.ts";

/** Tours activos con su ciudad; si falta la traducción, se usa el español. */
export async function listarExperiencias(idioma: Idioma, cliente?: Consulta) {
  const { rows } = await db(cliente).query<{
    codigo: string; categoria: string; imagen_url: string | null; precio_centavos: string | null; moneda: string; unidad_precio: "persona" | "grupo";
    nombre: string; descripcion: string; duracion: string | null; ciudad: string; ciudad_slug: string; traducido: boolean;
  }>(
    `SELECT e.codigo, e.categoria, e.imagen_url, e.precio_centavos, e.moneda_codigo AS moneda, e.unidad_precio,
       coalesce(t.nombre, t_es.nombre) AS nombre, coalesce(t.descripcion, t_es.descripcion) AS descripcion, coalesce(t.duracion, t_es.duracion) AS duracion,
       ct.nombre AS ciudad, ct.slug AS ciudad_slug, (t.experiencia_id IS NOT NULL) AS traducido
     FROM experiencias.experiencias e
     JOIN geo.ciudad_traducciones ct ON ct.ciudad_id = e.ciudad_id AND ct.idioma_codigo = $1
     LEFT JOIN experiencias.experiencia_traducciones t ON t.experiencia_id = e.id AND t.idioma_codigo = $1
     LEFT JOIN experiencias.experiencia_traducciones t_es ON t_es.experiencia_id = e.id AND t_es.idioma_codigo = 'es'
     WHERE e.esta_activa ORDER BY ct.nombre, coalesce(t.nombre, t_es.nombre)`,
    [idioma],
  );
  return rows;
}
