INSERT INTO experiencias (slug, nombre, categoria, descripcion, duracion, imagen_url, precio_usd, unidad_precio, activa)
VALUES (
  'centro-historico-getsemani',
  'Centro Histórico y Getsemaní',
  'Cultura',
  'Recorrido cultural sujeto a disponibilidad. Consulta horarios, punto de encuentro, guía e inclusiones antes de confirmar.',
  'Medio día',
  'https://images.unsplash.com/photo-1533105079780-92b9be482077?auto=format&fit=crop&w=900&q=80',
  NULL,
  'persona',
  1
)
ON CONFLICT(slug) DO UPDATE SET
  nombre = excluded.nombre,
  categoria = excluded.categoria,
  descripcion = excluded.descripcion,
  duracion = excluded.duracion,
  imagen_url = excluded.imagen_url,
  activa = 1;

INSERT INTO experiencias (slug, nombre, categoria, descripcion, duracion, imagen_url, precio_usd, unidad_precio, activa)
VALUES (
  'islas-del-rosario',
  'Tour 5 Islas del Rosario',
  'Mar y naturaleza',
  'Incluye lancha deportiva, open bar a bordo hasta agotar existencias, almuerzo caribeño, animación a bordo y visita a 5 islas.',
  '8:00 a. m. - 5:00 p. m.',
  'https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=900&q=80',
  99.00,
  'persona',
  1
)
ON CONFLICT(slug) DO UPDATE SET
  nombre = excluded.nombre,
  categoria = excluded.categoria,
  descripcion = excluded.descripcion,
  duracion = excluded.duracion,
  imagen_url = excluded.imagen_url,
  precio_usd = excluded.precio_usd,
  unidad_precio = excluded.unidad_precio,
  activa = 1;

INSERT INTO experiencias (slug, nombre, categoria, descripcion, duracion, imagen_url, precio_usd, unidad_precio, activa)
VALUES (
  'atardecer-en-la-bahia',
  'Atardecer en la Bahía en Embarcación Bequia',
  'Navegación',
  'Incluye embarcación de 2 pisos, show a bordo, barra libre de tragos nacionales y cerveza, y vistas de Cartagena desde la bahía.',
  '5:00 p. m. - 8:00 p. m.',
  'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=900&q=80',
  60.00,
  'persona',
  1
)
ON CONFLICT(slug) DO UPDATE SET
  nombre = excluded.nombre,
  categoria = excluded.categoria,
  descripcion = excluded.descripcion,
  duracion = excluded.duracion,
  imagen_url = excluded.imagen_url,
  precio_usd = excluded.precio_usd,
  unidad_precio = excluded.unidad_precio,
  activa = 1;

INSERT INTO experiencias (slug, nombre, categoria, descripcion, duracion, imagen_url, precio_usd, unidad_precio, activa)
VALUES (
  'atardecer-bahia-lancha-deportiva',
  'Atardecer en la Bahía en Lancha Deportiva',
  'Navegación',
  'Incluye lancha deportiva, open bar a bordo, animación con DJ y música.',
  '5:00 p. m. - 8:00 p. m.',
  'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=900&q=80',
  30.00,
  'persona',
  1
)
ON CONFLICT(slug) DO UPDATE SET
  nombre = excluded.nombre,
  categoria = excluded.categoria,
  descripcion = excluded.descripcion,
  duracion = excluded.duracion,
  imagen_url = excluded.imagen_url,
  precio_usd = excluded.precio_usd,
  unidad_precio = excluded.unidad_precio,
  activa = 1;

INSERT INTO experiencias (slug, nombre, categoria, descripcion, duracion, imagen_url, precio_usd, unidad_precio, activa)
VALUES (
  'chiva-rumbera-nocturna',
  'Chiva Rumbera Nocturna en Cartagena',
  'Cultura y entretenimiento',
  'Incluye bus panorámico, música a bordo con juego de luces y paradas en Zapatos Sucios (Castillo de San Felipe), India Catalina y el letrero de Cartagena. No incluye bebidas con ni sin alcohol.',
  '7:00 p. m. - 9:00 p. m.',
  'https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=900&q=80',
  25.00,
  'persona',
  1
)
ON CONFLICT(slug) DO UPDATE SET
  nombre = excluded.nombre,
  categoria = excluded.categoria,
  descripcion = excluded.descripcion,
  duracion = excluded.duracion,
  imagen_url = excluded.imagen_url,
  precio_usd = excluded.precio_usd,
  unidad_precio = excluded.unidad_precio,
  activa = 1;

INSERT INTO experiencias (slug, nombre, categoria, descripcion, duracion, imagen_url, precio_usd, unidad_precio, activa)
VALUES (
  'sabores-de-cartagena',
  'Sabores de Cartagena',
  'Gastronomía',
  'Opciones gastronómicas locales bajo solicitud. Consulta menú, restricciones alimentarias, lugar y tarifa.',
  'Por confirmar',
  'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=900&q=80',
  NULL,
  'persona',
  1
)
ON CONFLICT(slug) DO UPDATE SET
  nombre = excluded.nombre,
  categoria = excluded.categoria,
  descripcion = excluded.descripcion,
  duracion = excluded.duracion,
  imagen_url = excluded.imagen_url,
  activa = 1;
