/**
 * Tours y cotizaciones automáticas (paridad con la web heredada): hospedaje con la mejor opción
 * disponible y el tour con su precio publicado. Si algo no tiene precio, la cotización queda parcial.
 */
import { randomBytes } from "node:crypto";
import { fichaHotel, type Idioma } from "./busqueda.ts";
import { db, enTransaccion, ErrorNegocio, type Consulta } from "./conexion.ts";
import { encolarCorreo } from "./notificaciones.ts";
import { formatoDinero } from "./reservas.ts";

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

export interface LineaCotizacion {
  concepto: "hospedaje" | "experiencia";
  descripcion: string;
  montoCentavos: bigint | null;
}

export async function crearCotizacion(
  datos: {
    idioma: Idioma;
    nombre: string;
    correo: string;
    telefono: string;
    personas: number;
    hotelSlug?: string | null;
    experienciaCodigo?: string | null;
    entrada?: string | null;
    salida?: string | null;
    notas?: string | null;
  },
  cliente?: Consulta,
): Promise<{ codigo: string; lineas: LineaCotizacion[]; totalCentavos: bigint; parcial: boolean; moneda: string }> {
  if (datos.nombre.trim().length < 2) throw new ErrorNegocio("NOMBRE_INVALIDO", "Escribe tu nombre.", { campo: "nombre" });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(datos.correo.trim())) throw new ErrorNegocio("CORREO_INVALIDO", "El correo no es válido.", { campo: "correo" });
  if (!Number.isInteger(datos.personas) || datos.personas < 1 || datos.personas > 50) throw new ErrorNegocio("HUESPEDES_INVALIDOS", "Indica entre 1 y 50 personas.", { campo: "personas" });
  if (!datos.hotelSlug && !datos.experienciaCodigo) throw new ErrorNegocio("COTIZACION_VACIA", "Elige un hotel o un tour para cotizar.", { campo: "hotel" });
  const es = datos.idioma === "es";

  return enTransaccion(async (tx) => {
    const lineas: (LineaCotizacion & { hotelId?: string; experienciaId?: string })[] = [];
    if (datos.hotelSlug) {
      const conFechas = Boolean(datos.entrada && datos.salida);
      const ficha = await fichaHotel(datos.hotelSlug, datos.idioma, conFechas ? { entrada: datos.entrada!, salida: datos.salida!, huespedes: Math.min(datos.personas, 12), idioma: datos.idioma } : null, tx);
      if (!ficha) throw new ErrorNegocio("HOTEL_NO_DISPONIBLE", "Este hotel ya no está disponible.", { estado: 404 });
      const opcion = ficha.opciones.find((o) => o.disponible) ?? ficha.opciones[0];
      lineas.push({
        concepto: "hospedaje",
        hotelId: ficha.id,
        descripcion: opcion ? `${ficha.nombre} · ${opcion.habitacion} · ${datos.entrada} → ${datos.salida}` : `${ficha.nombre} (${es ? "sin precio para esas fechas" : "no price for those dates"})`,
        montoCentavos: opcion?.totalCentavos ?? null,
      });
    }
    if (datos.experienciaCodigo) {
      const experiencia = (await tx.query<{ id: string; nombre: string; precio_centavos: string | null; unidad_precio: string }>(
        `SELECT e.id, coalesce(t.nombre, t_es.nombre) AS nombre, e.precio_centavos, e.unidad_precio FROM experiencias.experiencias e
         LEFT JOIN experiencias.experiencia_traducciones t ON t.experiencia_id = e.id AND t.idioma_codigo = $2
         LEFT JOIN experiencias.experiencia_traducciones t_es ON t_es.experiencia_id = e.id AND t_es.idioma_codigo = 'es'
         WHERE e.codigo = $1 AND e.esta_activa`,
        [datos.experienciaCodigo, datos.idioma],
      )).rows[0];
      if (!experiencia) throw new ErrorNegocio("EXPERIENCIA_NO_DISPONIBLE", "Ese tour ya no está disponible.", { estado: 404 });
      const precio = experiencia.precio_centavos === null ? null : BigInt(experiencia.precio_centavos);
      lineas.push({
        concepto: "experiencia",
        experienciaId: experiencia.id,
        descripcion: `${experiencia.nombre} · ${datos.personas} ${es ? "personas" : "people"}`,
        montoCentavos: precio === null ? null : experiencia.unidad_precio === "grupo" ? precio : precio * BigInt(datos.personas),
      });
    }

    const codigo = `WP-C-${randomBytes(8).toString("hex").toUpperCase()}`;
    const cotizacion = (await tx.query<{ id: string }>(
      `INSERT INTO experiencias.cotizaciones (codigo, nombre, correo, telefono, idioma_codigo, moneda_codigo, personas, fecha_entrada, fecha_salida, notas)
       VALUES ($1, $2, $3, $4, $5, 'USD', $6, $7, $8, $9) RETURNING id`,
      [codigo, datos.nombre.trim(), datos.correo.trim().toLowerCase(), datos.telefono.trim(), datos.idioma, datos.personas, datos.entrada || null, datos.salida || null, datos.notas?.trim() || null],
    )).rows[0];
    for (const linea of lineas) {
      await tx.query(
        "INSERT INTO experiencias.cotizacion_lineas (cotizacion_id, concepto, hotel_id, experiencia_id, descripcion, monto_centavos) VALUES ($1, $2, $3, $4, $5, $6)",
        [cotizacion.id, linea.concepto, linea.hotelId ?? null, linea.experienciaId ?? null, linea.descripcion, linea.montoCentavos?.toString() ?? null],
      );
    }
    const totalCentavos = lineas.reduce((suma, l) => suma + (l.montoCentavos ?? 0n), 0n);
    const parcial = lineas.some((l) => l.montoCentavos === null);
    await encolarCorreo(
      {
        para: datos.correo,
        plantilla: "cotizacion",
        idioma: datos.idioma,
        asunto: es ? `Tu cotización ${codigo}` : `Your quote ${codigo}`,
        texto: [
          es ? `Hola ${datos.nombre.trim()}:` : `Hi ${datos.nombre.trim()},`,
          "",
          ...lineas.map((l) => `· ${l.descripcion}: ${l.montoCentavos === null ? (es ? "a confirmar" : "to be confirmed") : formatoDinero(l.montoCentavos, "USD", datos.idioma)}`),
          "",
          `${es ? "Total estimado" : "Estimated total"}: ${formatoDinero(totalCentavos, "USD", datos.idioma)}${parcial ? (es ? " (parcial)" : " (partial)") : ""}`,
          es ? "Disponibilidad y precio final se confirman al reservar." : "Availability and final price are confirmed when booking.",
        ].join("\n"),
      },
      tx,
    );
    return { codigo, lineas: lineas.map(({ concepto, descripcion, montoCentavos }) => ({ concepto, descripcion, montoCentavos })), totalCentavos, parcial, moneda: "USD" };
  }, cliente);
}

/** El código (16 hex aleatorios) es la credencial para ver la cotización y su PDF, como en la web heredada. */
export async function obtenerCotizacion(codigo: string, cliente?: Consulta) {
  if (!/^WP-C-[A-F0-9]{16}$/.test(codigo)) return null;
  const conexion = db(cliente);
  const cotizacion = (await conexion.query<{ id: string; codigo: string; nombre: string; idioma: Idioma; personas: number; fecha_entrada: string | null; fecha_salida: string | null; creado_en: Date }>(
    "SELECT id, codigo, nombre, idioma_codigo AS idioma, personas, fecha_entrada::text, fecha_salida::text, creado_en FROM experiencias.cotizaciones WHERE codigo = $1",
    [codigo],
  )).rows[0];
  if (!cotizacion) return null;
  const lineas = (await conexion.query<{ concepto: string; descripcion: string; monto_centavos: string | null }>(
    "SELECT concepto, descripcion, monto_centavos FROM experiencias.cotizacion_lineas WHERE cotizacion_id = $1 ORDER BY concepto DESC",
    [cotizacion.id],
  )).rows;
  const total = lineas.reduce((suma, l) => suma + BigInt(l.monto_centavos ?? 0), 0n);
  return { ...cotizacion, lineas, totalCentavos: total, parcial: lineas.some((l) => l.monto_centavos === null) };
}
