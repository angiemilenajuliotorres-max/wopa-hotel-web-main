-- 0007 · Datos de referencia del lanzamiento en Panamá (ADR-001).
-- Panamá: destino y país de cobro. Colombia: catálogo actual de Cartagena, vendido en USD desde Panamá.

INSERT INTO geo.idiomas (codigo, nombre) VALUES
  ('es', 'Español'),
  ('en', 'English');

INSERT INTO geo.monedas (codigo, nombre, simbolo, redondeo_centavos) VALUES
  ('USD', 'Dólar estadounidense', 'US$', 100),      -- redondeo a 1 USD
  ('COP', 'Peso colombiano', 'COL$', 100000);       -- redondeo a 1.000 COP

INSERT INTO geo.paises (codigo, moneda_codigo, esta_activo) VALUES
  ('PA', 'USD', true),
  ('CO', 'COP', true);

INSERT INTO geo.pais_traducciones (pais_codigo, idioma_codigo, nombre, slug) VALUES
  ('PA', 'es', 'Panamá', 'panama'),
  ('PA', 'en', 'Panama', 'panama'),
  ('CO', 'es', 'Colombia', 'colombia'),
  ('CO', 'en', 'Colombia', 'colombia');

WITH nuevas (pais, latitud, longitud, zona_horaria, slug, nombre_es, nombre_en) AS (
  VALUES
    ('PA', 8.983333, -79.516667, 'America/Panama', 'ciudad-de-panama', 'Ciudad de Panamá', 'Panama City'),
    ('PA', 8.780000, -82.441111, 'America/Panama', 'boquete', 'Boquete', 'Boquete'),
    ('PA', 9.340278, -82.241944, 'America/Panama', 'bocas-del-toro', 'Bocas del Toro', 'Bocas del Toro'),
    ('CO', 10.391049, -75.479426, 'America/Bogota', 'cartagena', 'Cartagena de Indias', 'Cartagena')
),
insertadas AS (
  INSERT INTO geo.ciudades (pais_codigo, latitud, longitud, zona_horaria, esta_activa)
  SELECT pais, latitud, longitud, zona_horaria, true FROM nuevas
  RETURNING id, pais_codigo, latitud, longitud
)
INSERT INTO geo.ciudad_traducciones (ciudad_id, idioma_codigo, nombre, slug)
SELECT i.id, t.idioma, t.nombre, n.slug
FROM insertadas i
JOIN nuevas n ON n.pais = i.pais_codigo AND n.latitud = i.latitud AND n.longitud = i.longitud
CROSS JOIN LATERAL (VALUES ('es', n.nombre_es), ('en', n.nombre_en)) AS t (idioma, nombre);

INSERT INTO geo.zonas (ciudad_id, nombre, slug)
SELECT ct.ciudad_id, z.nombre, z.slug
FROM geo.ciudad_traducciones ct
JOIN (VALUES
  ('ciudad-de-panama', 'Casco Antiguo', 'casco-antiguo'),
  ('ciudad-de-panama', 'Bella Vista', 'bella-vista'),
  ('cartagena', 'Centro Histórico', 'centro-historico'),
  ('cartagena', 'Getsemaní', 'getsemani'),
  ('cartagena', 'Bocagrande', 'bocagrande')
) AS z (ciudad_slug, nombre, slug) ON z.ciudad_slug = ct.slug
WHERE ct.idioma_codigo = 'es';

WITH nuevos (codigo, icono, nombre_es, nombre_en) AS (
  VALUES
    ('wifi', 'wifi', 'WiFi', 'Wi-Fi'),
    ('aire_acondicionado', 'snowflake', 'Aire acondicionado', 'Air conditioning'),
    ('desayuno_incluido', 'coffee', 'Desayuno incluido', 'Breakfast included'),
    ('minibar', 'wine', 'Minibar', 'Minibar'),
    ('tv', 'tv', 'Televisión', 'TV'),
    ('piscina', 'waves', 'Piscina', 'Swimming pool'),
    ('gimnasio', 'dumbbell', 'Gimnasio', 'Gym'),
    ('restaurante', 'utensils', 'Restaurante', 'Restaurant'),
    ('spa', 'flower', 'Spa', 'Spa'),
    ('playa_privada', 'umbrella', 'Playa privada', 'Private beach'),
    ('recepcion_24h', 'clock', 'Recepción 24 horas', '24-hour front desk'),
    ('terraza', 'sun', 'Terraza', 'Terrace'),
    ('parqueo', 'car', 'Parqueo', 'Parking'),
    ('cocina', 'chef-hat', 'Cocina', 'Kitchen'),
    ('lavanderia', 'shirt', 'Lavandería', 'Laundry'),
    ('concierge', 'bell', 'Concierge', 'Concierge')
),
insertados AS (
  INSERT INTO catalogo.servicios (codigo, icono)
  SELECT codigo, icono FROM nuevos
  RETURNING id, codigo
)
INSERT INTO catalogo.servicio_traducciones (servicio_id, idioma_codigo, nombre)
SELECT i.id, t.idioma, t.nombre
FROM insertados i
JOIN nuevos n USING (codigo)
CROSS JOIN LATERAL (VALUES ('es', n.nombre_es), ('en', n.nombre_en)) AS t (idioma, nombre);

-- Organización interna de WOPA (dueña de los roles wopa_*).
INSERT INTO identidad.organizaciones (nombre, tipo) VALUES ('WOPA Travel', 'wopa');
