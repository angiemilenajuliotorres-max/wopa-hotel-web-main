/**
 * Búsqueda pública: autocompletado de destinos, resultados con precio total de la estadía
 * (neta + margen, calculado con @wopa/dominio) y ficha de hotel con todas sus opciones.
 * Nunca expone la tarifa neta ni el margen.
 */
import { calcularEstadia, SinMargenVigente, type Estadia, type ReglaMargenVigente } from "@wopa/dominio/tarifas";
import { db, ErrorNegocio, type Consulta } from "./conexion.ts";

export type Idioma = "es" | "en";

export interface Criterios {
  entrada: string;
  salida: string;
  huespedes: number;
  idioma: Idioma;
}

export interface OpcionHabitacion {
  tipoHabitacionId: string;
  planTarifaId: string;
  habitacion: string;
  plan: string;
  descripcionHabitacion: string | null;
  capacidad: number;
  incluyeDesayuno: boolean;
  modo: "anticipo_en_linea" | "solicitud";
  disponible: boolean;
  totalCentavos: bigint;
  anticipoCentavos: bigint;
  saldoCentavos: bigint;
  porNocheCentavos: bigint;
  politica: { diasAntesLlegada: number; penalizacionBp: number }[];
  /** Neta y margen por noche: solo para uso interno (reservas). Nunca se envía al público. */
  interno: Estadia;
}

export interface HotelResultado {
  id: string;
  slug: string;
  nombre: string;
  categoria: number | null;
  ciudad: string;
  zona: string | null;
  foto: string | null;
  moneda: string;
  modo: "anticipo_en_linea" | "solicitud";
  servicios: { codigo: string; nombre: string; icono: string }[];
  mejorOpcion: OpcionHabitacion | null;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_NOCHES = 30;

export function noches(entrada: string, salida: string): string[] {
  const lista: string[] = [];
  for (let dia = Date.parse(`${entrada}T00:00:00Z`); dia < Date.parse(`${salida}T00:00:00Z`); dia += 86_400_000) {
    lista.push(new Date(dia).toISOString().slice(0, 10));
  }
  return lista;
}

export function validarCriterios(criterios: Criterios, hoy = new Date().toISOString().slice(0, 10)): void {
  if (!FECHA.test(criterios.entrada) || !FECHA.test(criterios.salida)) throw new ErrorNegocio("FECHAS_INVALIDAS", "Elige las fechas de entrada y salida.", { campo: "entrada" });
  if (criterios.entrada < hoy) throw new ErrorNegocio("FECHA_PASADA", "La fecha de entrada ya pasó.", { campo: "entrada" });
  if (criterios.salida <= criterios.entrada) throw new ErrorNegocio("FECHAS_INVALIDAS", "La salida debe ser posterior a la entrada.", { campo: "salida" });
  if (noches(criterios.entrada, criterios.salida).length > MAX_NOCHES) throw new ErrorNegocio("ESTADIA_LARGA", `La estadía no puede superar ${MAX_NOCHES} noches.`, { campo: "salida" });
  if (!Number.isInteger(criterios.huespedes) || criterios.huespedes < 1 || criterios.huespedes > 12) throw new ErrorNegocio("HUESPEDES_INVALIDOS", "Indica entre 1 y 12 huéspedes.", { campo: "huespedes" });
}

// ---------------------------------------------------------------- destinos

export interface Destino {
  tipo: "ciudad" | "pais" | "hotel";
  slug: string;
  nombre: string;
  detalle: string;
  hoteles?: number;
  paisSlug?: string;
}

export async function buscarDestinos(texto: string, idioma: Idioma, cliente?: Consulta): Promise<Destino[]> {
  const termino = texto.trim();
  if (termino.length < 2) return [];
  const conexion = db(cliente);
  const patron = `%${termino}%`;

  const ciudades = await conexion.query<{ slug: string; nombre: string; pais: string; pais_slug: string; hoteles: number }>(
    `SELECT ct.slug, ct.nombre, pt.nombre AS pais, pt.slug AS pais_slug,
       (SELECT count(*)::int FROM catalogo.hoteles h WHERE h.ciudad_id = c.id AND h.estado = 'publicado' AND h.eliminado_en IS NULL) AS hoteles
     FROM geo.ciudades c
     JOIN geo.ciudad_traducciones ct ON ct.ciudad_id = c.id AND ct.idioma_codigo = $2
     JOIN geo.pais_traducciones pt ON pt.pais_codigo = c.pais_codigo AND pt.idioma_codigo = $2
     WHERE c.esta_activa AND (public.sin_acentos(ct.nombre) ILIKE public.sin_acentos($1) OR similarity(public.sin_acentos(ct.nombre), public.sin_acentos($3)) > 0.3)
     ORDER BY similarity(public.sin_acentos(ct.nombre), public.sin_acentos($3)) DESC LIMIT 5`,
    [patron, idioma, termino],
  );
  const paises = await conexion.query<{ slug: string; nombre: string; ciudades: number }>(
    `SELECT pt.slug, pt.nombre, (SELECT count(*)::int FROM geo.ciudades c WHERE c.pais_codigo = p.codigo AND c.esta_activa) AS ciudades
     FROM geo.paises p JOIN geo.pais_traducciones pt ON pt.pais_codigo = p.codigo AND pt.idioma_codigo = $2
     WHERE p.esta_activo AND public.sin_acentos(pt.nombre) ILIKE public.sin_acentos($1) LIMIT 3`,
    [patron, idioma],
  );
  const hoteles = await conexion.query<{ slug: string; nombre: string; ciudad: string }>(
    `SELECT h.slug, h.nombre, ct.nombre AS ciudad FROM catalogo.hoteles h
     JOIN geo.ciudad_traducciones ct ON ct.ciudad_id = h.ciudad_id AND ct.idioma_codigo = $2
     WHERE h.estado = 'publicado' AND h.eliminado_en IS NULL
       AND (public.sin_acentos(h.nombre) ILIKE public.sin_acentos($1) OR similarity(public.sin_acentos(h.nombre), public.sin_acentos($3)) > 0.3)
     ORDER BY similarity(public.sin_acentos(h.nombre), public.sin_acentos($3)) DESC LIMIT 5`,
    [patron, idioma, termino],
  );
  return [
    ...ciudades.rows.map((c) => ({ tipo: "ciudad" as const, slug: c.slug, nombre: c.nombre, detalle: c.pais, hoteles: c.hoteles, paisSlug: c.pais_slug })),
    ...paises.rows.map((p) => ({ tipo: "pais" as const, slug: p.slug, nombre: p.nombre, detalle: `${p.ciudades}` })),
    ...hoteles.rows.map((h) => ({ tipo: "hotel" as const, slug: h.slug, nombre: h.nombre, detalle: h.ciudad })),
  ];
}

// ---------------------------------------------------------------- cotización interna de opciones

interface FilaOpcion {
  hotel_id: string;
  modo_reserva: "anticipo_en_linea" | "solicitud";
  tipo_habitacion_id: string;
  capacidad_maxima: number;
  habitacion: string;
  descripcion_habitacion: string | null;
  plan_tarifa_id: string;
  plan: string;
  anticipo_bp: number;
  incluye_desayuno: boolean;
  politica_id: string;
  redondeo_centavos: string;
}

/** Opciones (habitación × plan) de varios hoteles para las fechas y huéspedes dados. */
export async function opcionesDeHoteles(conexion: Consulta, hotelIds: string[], criterios: Criterios): Promise<Map<string, OpcionHabitacion[]>> {
  const resultado = new Map<string, OpcionHabitacion[]>();
  if (hotelIds.length === 0) return resultado;
  const listaNoches = noches(criterios.entrada, criterios.salida);
  const ultimaNoche = listaNoches.at(-1)!;

  const opciones = (await conexion.query<FilaOpcion>(
    `SELECT h.id AS hotel_id, h.modo_reserva, t.id AS tipo_habitacion_id, t.capacidad_maxima,
       coalesce(tt.nombre, tt_es.nombre, t.codigo) AS habitacion, coalesce(tt.descripcion, tt_es.descripcion) AS descripcion_habitacion,
       p.id AS plan_tarifa_id, coalesce(pt.nombre, pt_es.nombre, p.codigo) AS plan, p.anticipo_bp, p.incluye_desayuno,
       p.politica_cancelacion_id AS politica_id, m.redondeo_centavos
     FROM catalogo.hoteles h
     JOIN geo.monedas m ON m.codigo = h.moneda_codigo
     JOIN catalogo.tipos_habitacion t ON t.hotel_id = h.id AND t.esta_activo AND t.capacidad_maxima >= $2
     LEFT JOIN catalogo.tipo_habitacion_traducciones tt ON tt.tipo_habitacion_id = t.id AND tt.idioma_codigo = $3
     LEFT JOIN catalogo.tipo_habitacion_traducciones tt_es ON tt_es.tipo_habitacion_id = t.id AND tt_es.idioma_codigo = 'es'
     JOIN tarifas.planes_tarifa p ON p.hotel_id = h.id AND p.esta_activo
     LEFT JOIN tarifas.plan_tarifa_traducciones pt ON pt.plan_tarifa_id = p.id AND pt.idioma_codigo = $3
     LEFT JOIN tarifas.plan_tarifa_traducciones pt_es ON pt_es.plan_tarifa_id = p.id AND pt_es.idioma_codigo = 'es'
     WHERE h.id = ANY($1::uuid[])`,
    [hotelIds, criterios.huespedes, criterios.idioma],
  )).rows;
  if (opciones.length === 0) return resultado;

  // Precio por noche: la ocupación exacta o la menor ocupación cargada que alcance a los huéspedes.
  const precios = (await conexion.query<{ plan_tarifa_id: string; tipo_habitacion_id: string; fecha: string; monto: string; estancia_minima: number }>(
    `SELECT DISTINCT ON (plan_tarifa_id, tipo_habitacion_id, fecha)
       plan_tarifa_id, tipo_habitacion_id, fecha::text, monto_neto_centavos AS monto, estancia_minima
     FROM tarifas.precios_dia
     WHERE hotel_id = ANY($1::uuid[]) AND fecha BETWEEN $2 AND $3 AND ocupacion >= $4
     ORDER BY plan_tarifa_id, tipo_habitacion_id, fecha, ocupacion`,
    [hotelIds, criterios.entrada, ultimaNoche, criterios.huespedes],
  )).rows;
  const cupos = (await conexion.query<{ tipo_habitacion_id: string; libres: number }>(
    `SELECT tipo_habitacion_id, count(*)::int AS libres FROM tarifas.cupos_dia
     WHERE tipo_habitacion_id = ANY($1::uuid[]) AND fecha BETWEEN $2 AND $3 AND NOT esta_cerrado AND cupo_total - cupo_vendido >= 1
     GROUP BY tipo_habitacion_id`,
    [[...new Set(opciones.map((o) => o.tipo_habitacion_id))], criterios.entrada, ultimaNoche],
  )).rows;
  const reglas = (await conexion.query<{ id: string; hotel_id: string; plan_tarifa_id: string | null; vigente_desde: string; vigente_hasta: string | null; tipo: string; porcentaje_bp: number | null; monto_centavos: string | null }>(
    `SELECT id, hotel_id, plan_tarifa_id, vigente_desde::text, vigente_hasta::text, tipo, porcentaje_bp, monto_centavos
     FROM tarifas.reglas_margen WHERE hotel_id = ANY($1::uuid[]) AND vigente_desde <= $3 AND (vigente_hasta IS NULL OR vigente_hasta >= $2)`,
    [hotelIds, criterios.entrada, ultimaNoche],
  )).rows;
  const politicas = (await conexion.query<{ politica_id: string; dias_antes_llegada: number; penalizacion_bp: number }>(
    "SELECT politica_id, dias_antes_llegada, penalizacion_bp FROM tarifas.politica_reglas WHERE politica_id = ANY($1::uuid[]) ORDER BY dias_antes_llegada DESC",
    [[...new Set(opciones.map((o) => o.politica_id))]],
  )).rows;

  const libresPorHabitacion = new Map(cupos.map((c) => [c.tipo_habitacion_id, c.libres]));
  for (const opcion of opciones) {
    const preciosOpcion = precios.filter((p) => p.plan_tarifa_id === opcion.plan_tarifa_id && p.tipo_habitacion_id === opcion.tipo_habitacion_id);
    if (preciosOpcion.length !== listaNoches.length) continue; // falta precio en alguna noche
    if (preciosOpcion.some((p) => p.estancia_minima > listaNoches.length)) continue;

    const reglasHotel: ReglaMargenVigente[] = reglas
      .filter((r) => r.hotel_id === opcion.hotel_id)
      .map((r) => ({
        id: r.id,
        planTarifaId: r.plan_tarifa_id,
        vigenteDesde: r.vigente_desde,
        vigenteHasta: r.vigente_hasta,
        regla: r.tipo === "porcentaje" ? { tipo: "porcentaje", porcentajeBp: r.porcentaje_bp! } : { tipo: "monto_fijo", montoCentavos: BigInt(r.monto_centavos!) },
      }));

    let estadia: Estadia;
    try {
      estadia = calcularEstadia({
        noches: preciosOpcion.map((p) => ({ fecha: p.fecha, netoCentavos: BigInt(p.monto) })),
        planTarifaId: opcion.plan_tarifa_id,
        reglasMargen: reglasHotel,
        anticipoBp: opcion.anticipo_bp,
        redondeoCentavos: BigInt(opcion.redondeo_centavos),
      });
    } catch (error) {
      if (error instanceof SinMargenVigente) continue; // sin margen no se vende
      throw error;
    }

    const disponible = opcion.modo_reserva === "solicitud" || (libresPorHabitacion.get(opcion.tipo_habitacion_id) ?? 0) === listaNoches.length;
    const lista = resultado.get(opcion.hotel_id) ?? [];
    lista.push({
      tipoHabitacionId: opcion.tipo_habitacion_id,
      planTarifaId: opcion.plan_tarifa_id,
      habitacion: opcion.habitacion,
      plan: opcion.plan,
      descripcionHabitacion: opcion.descripcion_habitacion,
      capacidad: opcion.capacidad_maxima,
      incluyeDesayuno: opcion.incluye_desayuno,
      modo: opcion.modo_reserva,
      disponible,
      totalCentavos: estadia.totalVentaCentavos,
      anticipoCentavos: estadia.anticipoCentavos,
      saldoCentavos: estadia.saldoCentavos,
      porNocheCentavos: estadia.totalVentaCentavos / BigInt(listaNoches.length),
      politica: politicas.filter((p) => p.politica_id === opcion.politica_id).map((p) => ({ diasAntesLlegada: p.dias_antes_llegada, penalizacionBp: p.penalizacion_bp })),
      interno: estadia,
    });
    resultado.set(opcion.hotel_id, lista);
  }
  for (const lista of resultado.values()) lista.sort((a, b) => Number(Number(b.disponible) - Number(a.disponible)) || Number(a.totalCentavos - b.totalCentavos));
  return resultado;
}

// ---------------------------------------------------------------- resultados y ficha

export async function buscarHoteles(
  destino: { tipo: "ciudad" | "pais"; slug: string },
  criterios: Criterios,
  cliente?: Consulta,
): Promise<{ destino: { nombre: string; pais: string } | null; noches: number; hoteles: HotelResultado[] }> {
  validarCriterios(criterios);
  const conexion = db(cliente);
  const filtro = destino.tipo === "ciudad"
    ? "EXISTS (SELECT 1 FROM geo.ciudad_traducciones x WHERE x.ciudad_id = h.ciudad_id AND x.slug = $1)"
    : "EXISTS (SELECT 1 FROM geo.pais_traducciones x WHERE x.pais_codigo = c.pais_codigo AND x.slug = $1)";

  const hoteles = (await conexion.query<{
    id: string; slug: string; nombre: string; categoria: number | null; ciudad: string; pais: string; zona: string | null; foto: string | null; moneda: string; modo: "anticipo_en_linea" | "solicitud";
  }>(
    `SELECT h.id, h.slug, h.nombre, h.categoria, ct.nombre AS ciudad, pt.nombre AS pais, z.nombre AS zona, h.moneda_codigo AS moneda, h.modo_reserva AS modo,
       (SELECT url FROM catalogo.fotos f WHERE f.hotel_id = h.id AND f.tipo_habitacion_id IS NULL ORDER BY orden LIMIT 1) AS foto
     FROM catalogo.hoteles h
     JOIN geo.ciudades c ON c.id = h.ciudad_id
     JOIN geo.ciudad_traducciones ct ON ct.ciudad_id = c.id AND ct.idioma_codigo = $2
     JOIN geo.pais_traducciones pt ON pt.pais_codigo = c.pais_codigo AND pt.idioma_codigo = $2
     LEFT JOIN geo.zonas z ON z.id = h.zona_id
     WHERE h.estado = 'publicado' AND h.eliminado_en IS NULL AND ${filtro}`,
    [destino.slug, criterios.idioma],
  )).rows;

  const servicios = await serviciosDe(conexion, hoteles.map((h) => h.id), criterios.idioma);
  const opciones = await opcionesDeHoteles(conexion, hoteles.map((h) => h.id), criterios);
  const resultados: HotelResultado[] = hoteles.map((h) => ({
    id: h.id, slug: h.slug, nombre: h.nombre, categoria: h.categoria, ciudad: h.ciudad, zona: h.zona, foto: h.foto, moneda: h.moneda, modo: h.modo,
    servicios: servicios.get(h.id) ?? [],
    mejorOpcion: opciones.get(h.id)?.find((o) => o.disponible) ?? opciones.get(h.id)?.[0] ?? null,
  }));
  // Disponibles primero, luego por precio total; los que no tienen precio para esas fechas, al final.
  resultados.sort((a, b) => {
    const rango = (x: HotelResultado) => (x.mejorOpcion?.disponible ? 0 : x.mejorOpcion ? 1 : 2);
    return rango(a) - rango(b) || Number((a.mejorOpcion?.totalCentavos ?? 0n) - (b.mejorOpcion?.totalCentavos ?? 0n));
  });

  const nombreDestino = destino.tipo === "ciudad"
    ? (await conexion.query<{ nombre: string; pais: string }>(
        `SELECT ct.nombre, pt.nombre AS pais FROM geo.ciudad_traducciones ct JOIN geo.ciudades c ON c.id = ct.ciudad_id
         JOIN geo.pais_traducciones pt ON pt.pais_codigo = c.pais_codigo AND pt.idioma_codigo = ct.idioma_codigo
         WHERE ct.slug = $1 AND ct.idioma_codigo = $2`, [destino.slug, criterios.idioma])).rows[0] ?? null
    : (await conexion.query<{ nombre: string; pais: string }>(
        "SELECT nombre, nombre AS pais FROM geo.pais_traducciones WHERE slug = $1 AND idioma_codigo = $2", [destino.slug, criterios.idioma])).rows[0] ?? null;
  return { destino: nombreDestino, noches: noches(criterios.entrada, criterios.salida).length, hoteles: resultados };
}

async function serviciosDe(conexion: Consulta, hotelIds: string[], idioma: Idioma) {
  const mapa = new Map<string, { codigo: string; nombre: string; icono: string }[]>();
  if (hotelIds.length === 0) return mapa;
  const { rows } = await conexion.query<{ hotel_id: string; codigo: string; nombre: string; icono: string }>(
    `SELECT hs.hotel_id, s.codigo, st.nombre, s.icono FROM catalogo.hotel_servicios hs
     JOIN catalogo.servicios s ON s.id = hs.servicio_id
     JOIN catalogo.servicio_traducciones st ON st.servicio_id = s.id AND st.idioma_codigo = $2
     WHERE hs.hotel_id = ANY($1::uuid[]) ORDER BY st.nombre`,
    [hotelIds, idioma],
  );
  for (const fila of rows) mapa.set(fila.hotel_id, [...(mapa.get(fila.hotel_id) ?? []), { codigo: fila.codigo, nombre: fila.nombre, icono: fila.icono }]);
  return mapa;
}

export async function fichaHotel(slug: string, idioma: Idioma, criterios: Criterios | null, cliente?: Consulta) {
  const conexion = db(cliente);
  const hotel = (await conexion.query<{
    id: string; slug: string; nombre: string; categoria: number | null; direccion: string; latitud: string; longitud: string;
    hora_check_in: string; hora_check_out: string; moneda: string; modo: "anticipo_en_linea" | "solicitud";
    ciudad: string; ciudad_slug: string; pais: string; pais_slug: string; zona: string | null;
    descripcion: string | null; como_llegar: string | null; traduccion_disponible: boolean;
  }>(
    `SELECT h.id, h.slug, h.nombre, h.categoria, h.direccion, h.latitud, h.longitud, h.hora_check_in::text, h.hora_check_out::text,
       h.moneda_codigo AS moneda, h.modo_reserva AS modo, ct.nombre AS ciudad, ct.slug AS ciudad_slug, pt.nombre AS pais, pt.slug AS pais_slug, z.nombre AS zona,
       coalesce(tr.descripcion, tr_es.descripcion) AS descripcion, coalesce(tr.como_llegar, tr_es.como_llegar) AS como_llegar,
       (tr.hotel_id IS NOT NULL) AS traduccion_disponible
     FROM catalogo.hoteles h
     JOIN geo.ciudades c ON c.id = h.ciudad_id
     JOIN geo.ciudad_traducciones ct ON ct.ciudad_id = c.id AND ct.idioma_codigo = $2
     JOIN geo.pais_traducciones pt ON pt.pais_codigo = c.pais_codigo AND pt.idioma_codigo = $2
     LEFT JOIN geo.zonas z ON z.id = h.zona_id
     LEFT JOIN catalogo.hotel_traducciones tr ON tr.hotel_id = h.id AND tr.idioma_codigo = $2
     LEFT JOIN catalogo.hotel_traducciones tr_es ON tr_es.hotel_id = h.id AND tr_es.idioma_codigo = 'es'
     WHERE h.slug = $1 AND h.estado = 'publicado' AND h.eliminado_en IS NULL`,
    [slug, idioma],
  )).rows[0];
  if (!hotel) return null;

  const fotos = (await conexion.query<{ url: string }>("SELECT url FROM catalogo.fotos WHERE hotel_id = $1 ORDER BY orden, creado_en", [hotel.id])).rows.map((f) => f.url);
  const servicios = (await serviciosDe(conexion, [hotel.id], idioma)).get(hotel.id) ?? [];
  const opciones = criterios ? (validarCriterios(criterios), (await opcionesDeHoteles(conexion, [hotel.id], criterios)).get(hotel.id) ?? []) : [];
  return { ...hotel, latitud: Number(hotel.latitud), longitud: Number(hotel.longitud), fotos, servicios, opciones };
}

/** Destinos destacados para la portada: ciudades activas con hoteles publicados. */
export async function destinosDestacados(idioma: Idioma, cliente?: Consulta) {
  const { rows } = await db(cliente).query<{ slug: string; nombre: string; pais: string; pais_slug: string; hoteles: number; foto: string | null }>(
    `SELECT ct.slug, ct.nombre, pt.nombre AS pais, pt.slug AS pais_slug, count(h.id)::int AS hoteles,
       (SELECT f.url FROM catalogo.fotos f JOIN catalogo.hoteles h2 ON h2.id = f.hotel_id
        WHERE h2.ciudad_id = c.id AND h2.estado = 'publicado' ORDER BY f.orden LIMIT 1) AS foto
     FROM geo.ciudades c
     JOIN geo.ciudad_traducciones ct ON ct.ciudad_id = c.id AND ct.idioma_codigo = $1
     JOIN geo.pais_traducciones pt ON pt.pais_codigo = c.pais_codigo AND pt.idioma_codigo = $1
     LEFT JOIN catalogo.hoteles h ON h.ciudad_id = c.id AND h.estado = 'publicado' AND h.eliminado_en IS NULL
     WHERE c.esta_activa
     GROUP BY c.id, ct.slug, ct.nombre, pt.nombre, pt.slug
     ORDER BY count(h.id) DESC, ct.nombre`,
    [idioma],
  );
  return rows;
}
