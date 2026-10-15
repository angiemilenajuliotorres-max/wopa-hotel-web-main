import { crearBaseMigrada, crearBaseVacia, type BaseDePrueba } from "../src/pruebas.ts";

export { crearBaseMigrada, crearBaseVacia, type BaseDePrueba };

/** Devuelve el id de la primera fila. */
export async function insertar(db: BaseDePrueba, sql: string, parametros: unknown[] = []): Promise<string> {
  const { rows } = await db.query<{ id: string }>(sql, parametros);
  return rows[0].id;
}

/**
 * Crea un hotel aceptado (sin publicar) en Ciudad de Panamá, con un usuario de WOPA,
 * un plan con política de cancelación y un tipo de habitación.
 */
export async function crearHotelDePrueba(db: BaseDePrueba, slug = "hotel-prueba") {
  const usuarioWopa = await insertar(
    db,
    "INSERT INTO identidad.usuarios (correo, nombre) VALUES ($1, 'Operaciones WOPA') RETURNING id",
    [`ops+${slug}@wopa.test`],
  );
  const organizacion = await insertar(
    db,
    "INSERT INTO identidad.organizaciones (nombre, tipo) VALUES ($1, 'hotel') RETURNING id",
    [`Org ${slug}`],
  );
  const ciudad = await insertar(db, "SELECT ciudad_id AS id FROM geo.ciudad_traducciones WHERE slug = 'ciudad-de-panama' AND idioma_codigo = 'es'");
  const hotel = await insertar(
    db,
    `INSERT INTO catalogo.hoteles
       (organizacion_id, ciudad_id, slug, nombre, moneda_codigo, zona_horaria, latitud, longitud, direccion, aceptado_por, aceptado_en)
     VALUES ($1, $2, $3, 'Hotel de Prueba', 'USD', 'America/Panama', 8.95, -79.53, 'Calle 1', $4, now())
     RETURNING id`,
    [organizacion, ciudad, slug, usuarioWopa],
  );
  const politica = await insertar(
    db,
    "INSERT INTO tarifas.politicas_cancelacion (hotel_id, codigo) VALUES ($1, 'flexible') RETURNING id",
    [hotel],
  );
  const plan = await insertar(
    db,
    "INSERT INTO tarifas.planes_tarifa (hotel_id, politica_cancelacion_id, codigo) VALUES ($1, $2, 'base') RETURNING id",
    [hotel, politica],
  );
  const habitacion = await insertar(
    db,
    "INSERT INTO catalogo.tipos_habitacion (hotel_id, codigo, capacidad_maxima) VALUES ($1, 'doble', 2) RETURNING id",
    [hotel],
  );
  return { usuarioWopa, organizacion, ciudad, hotel, politica, plan, habitacion };
}
