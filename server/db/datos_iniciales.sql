-- Insertar hotel OPPA (agencia de viajes)
INSERT INTO hoteles (nombre, slug, descripcion, direccion, ciudad, pais, rnt, telefono, correo)
VALUES (
  'OPPA - Hospedajes Cartagena',
  'oppa-hospedajes',
  'Agencia de viajes OPPA ofrece selección de los mejores hospedajes en Cartagena de Indias',
  'Cartagena de Indias',
  'Cartagena',
  'Colombia',
  'RNT-OPPA',
  '50762869154',
  'reservas@oppa.com'
);

-- Obtener el ID del hotel recién creado
-- (En SQLite, podemos usar last_insert_rowid() en la aplicación)

-- Insertar tipos de habitación basados en los datos proporcionados

-- Hotel La Casona de Getsemaní
INSERT INTO tipos_habitacion (hotel_id, nombre, descripcion, capacidad_minima, capacidad_maxima, servicios)
VALUES (1, 'La Casona de Getsemaní', 'Hotel boutique en el corazón del Getsemaní', 1, 4, 'WiFi, Aire acondicionado, Desayuno incluido, Minibar');

-- Hotel Marina Suites by GEH Suites
INSERT INTO tipos_habitacion (hotel_id, nombre, descripcion, capacidad_minima, capacidad_maxima, servicios)
VALUES (1, 'Marina Suites by GEH Suites', 'Suites modernas con vistas al mar', 1, 4, 'WiFi, TV cable, Piscina, Gimnasio, Restaurante');

-- Hotel Dorado Centro Histórico
INSERT INTO tipos_habitacion (hotel_id, nombre, descripcion, capacidad_minima, capacidad_maxima, servicios)
VALUES (1, 'Dorado Centro Histórico', 'Hotel en el corazón del centro histórico', 1, 4, 'WiFi, Aire acondicionado, Concierge 24/7, Parqueo');

-- Wala Hotel and Beach Club Bocagrande
INSERT INTO tipos_habitacion (hotel_id, nombre, descripcion, capacidad_minima, capacidad_maxima, servicios)
VALUES (1, 'Wala Hotel and Beach Club Bocagrande', 'Resort de lujo frente al mar en Bocagrande', 1, 4, 'WiFi, Piscina, Playa privada, Spa, Restaurante gourmet');

-- Mintaka Hotel and Lounge
INSERT INTO tipos_habitacion (hotel_id, nombre, descripcion, capacidad_minima, capacidad_maxima, servicios)
VALUES (1, 'Mintaka Hotel and Lounge', 'Opción económica y acogedora', 1, 4, 'WiFi, Aire acondicionado, Recepción 24/7, Terraza');

-- Hotel Aixo Suites by GEH Suites
INSERT INTO tipos_habitacion (hotel_id, nombre, descripcion, capacidad_minima, capacidad_maxima, servicios)
VALUES (1, 'Aixo Suites by GEH Suites', 'Apartamentos amueblados con servicios hoteleros', 1, 4, 'WiFi, Cocina, Aire acondicionado, Parqueo, Lavandería');

-- Hotel Atlantic Luc
INSERT INTO tipos_habitacion (hotel_id, nombre, descripcion, capacidad_minima, capacidad_maxima, servicios)
VALUES (1, 'Hotel Atlantic Luc', 'Hotel frente al mar con servicios de lujo', 1, 4, 'WiFi, Piscina, Playa privada, Restaurante, Gimnasio');

-- Hotel Regatta
INSERT INTO tipos_habitacion (hotel_id, nombre, descripcion, capacidad_minima, capacidad_maxima, servicios)
VALUES (1, 'Hotel Regatta', 'Experiencia premium frente al Caribe', 1, 4, 'WiFi, Piscina infinita, Spa de lujo, Restaurante 5 estrellas, Concierge');

-- Insertar tarifas para cada tipo de habitación (1-2 personas y 3-4 personas, temporada baja)

-- Hotel La Casona de Getsemaní: $60 (1-2 pax), $90 (3-4 pax)
INSERT INTO tarifas (tipo_id, capacidad_personas, precio_usd, temporada)
VALUES (1, 2, 60.00, 'baja'), (1, 4, 90.00, 'baja');

-- Hotel Marina Suites: $60 (1-2 pax), $280 (3-4 pax)
INSERT INTO tarifas (tipo_id, capacidad_personas, precio_usd, temporada)
VALUES (2, 2, 60.00, 'baja'), (2, 4, 280.00, 'baja');

-- Hotel Dorado Centro Histórico: $60 (1-2 pax), $80 (3-4 pax)
INSERT INTO tarifas (tipo_id, capacidad_personas, precio_usd, temporada)
VALUES (3, 2, 60.00, 'baja'), (3, 4, 80.00, 'baja');

-- Wala Hotel and Beach Club: $120 (1-2 pax), $200 (3-4 pax)
INSERT INTO tarifas (tipo_id, capacidad_personas, precio_usd, temporada)
VALUES (4, 2, 120.00, 'baja'), (4, 4, 200.00, 'baja');

-- Mintaka Hotel and Lounge: $50 (1-2 pax), $80 (3-4 pax)
INSERT INTO tarifas (tipo_id, capacidad_personas, precio_usd, temporada)
VALUES (5, 2, 50.00, 'baja'), (5, 4, 80.00, 'baja');

-- Hotel Aixo Suites: $75 (1-2 pax), $110 (3-4 pax)
INSERT INTO tarifas (tipo_id, capacidad_personas, precio_usd, temporada)
VALUES (6, 2, 75.00, 'baja'), (6, 4, 110.00, 'baja');

-- Hotel Atlantic Luc: $110 (1-2 pax), $210 (3-4 pax)
INSERT INTO tarifas (tipo_id, capacidad_personas, precio_usd, temporada)
VALUES (7, 2, 110.00, 'baja'), (7, 4, 210.00, 'baja');

-- Hotel Regatta: $160 (1-2 pax), $240 (3-4 pax)
INSERT INTO tarifas (tipo_id, capacidad_personas, precio_usd, temporada)
VALUES (8, 2, 160.00, 'baja'), (8, 4, 240.00, 'baja');
