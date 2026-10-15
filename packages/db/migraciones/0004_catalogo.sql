-- 0004 · Hoteles, habitaciones, servicios, fotos y revisión de contenido.

CREATE TABLE catalogo.hoteles (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  organizacion_id   uuid NOT NULL,
  organizacion_tipo text NOT NULL DEFAULT 'hotel' CHECK (organizacion_tipo = 'hotel'),
  ciudad_id         uuid NOT NULL REFERENCES geo.ciudades (id) ON DELETE RESTRICT,
  zona_id           uuid REFERENCES geo.zonas (id) ON DELETE SET NULL,
  slug              text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,80}$'),
  nombre            text NOT NULL CHECK (length(nombre) BETWEEN 2 AND 120),
  categoria         smallint CHECK (categoria BETWEEN 1 AND 5),
  estado            text NOT NULL DEFAULT 'borrador'
                    CHECK (estado IN ('borrador', 'en_revision', 'publicado', 'suspendido')),
  modo_reserva      text NOT NULL DEFAULT 'anticipo_en_linea'
                    CHECK (modo_reserva IN ('anticipo_en_linea', 'solicitud')),
  moneda_codigo     char(3) NOT NULL REFERENCES geo.monedas (codigo) ON DELETE RESTRICT,
  zona_horaria      text NOT NULL,
  latitud           numeric(9, 6) NOT NULL CHECK (latitud BETWEEN -90 AND 90),
  longitud          numeric(9, 6) NOT NULL CHECK (longitud BETWEEN -180 AND 180),
  direccion         text NOT NULL,
  registro_turismo  text,                                  -- ATP en Panamá, RNT en Colombia
  correo_reservas   citext,
  telefono          text,
  hora_check_in     time NOT NULL DEFAULT '15:00',
  hora_check_out    time NOT NULL DEFAULT '12:00',
  aceptado_por      uuid REFERENCES identidad.usuarios (id) ON DELETE RESTRICT,
  aceptado_en       timestamptz,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  eliminado_en      timestamptz,
  FOREIGN KEY (organizacion_id, organizacion_tipo)
    REFERENCES identidad.organizaciones (id, tipo) ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK ((aceptado_por IS NULL) = (aceptado_en IS NULL)),
  CHECK (estado NOT IN ('publicado', 'suspendido') OR aceptado_en IS NOT NULL)
);
CREATE INDEX hoteles_organizacion_idx ON catalogo.hoteles (organizacion_id);
CREATE INDEX hoteles_zona_idx ON catalogo.hoteles (zona_id);
CREATE INDEX hoteles_ciudad_publicados_idx ON catalogo.hoteles (ciudad_id)
  WHERE estado = 'publicado' AND eliminado_en IS NULL;
CREATE INDEX hoteles_nombre_trgm_idx ON catalogo.hoteles USING gin (public.sin_acentos(nombre) gin_trgm_ops);
CREATE TRIGGER hoteles_actualizado_en BEFORE UPDATE ON catalogo.hoteles
  FOR EACH ROW EXECUTE FUNCTION public.fijar_actualizado_en();

CREATE TABLE catalogo.hotel_traducciones (
  hotel_id       uuid NOT NULL REFERENCES catalogo.hoteles (id) ON DELETE CASCADE,
  idioma_codigo  text NOT NULL REFERENCES geo.idiomas (codigo) ON DELETE RESTRICT,
  descripcion    text NOT NULL,
  como_llegar    text,
  esta_revisada  boolean NOT NULL DEFAULT false,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, idioma_codigo)
);
CREATE TRIGGER hotel_traducciones_actualizado_en BEFORE UPDATE ON catalogo.hotel_traducciones
  FOR EACH ROW EXECUTE FUNCTION public.fijar_actualizado_en();

CREATE TABLE catalogo.servicios (
  id     uuid PRIMARY KEY DEFAULT uuidv7(),
  codigo text NOT NULL UNIQUE CHECK (codigo ~ '^[a-z0-9_]{2,40}$'),
  icono  text NOT NULL
);

CREATE TABLE catalogo.servicio_traducciones (
  servicio_id   uuid NOT NULL REFERENCES catalogo.servicios (id) ON DELETE CASCADE,
  idioma_codigo text NOT NULL REFERENCES geo.idiomas (codigo) ON DELETE RESTRICT,
  nombre        text NOT NULL CHECK (length(nombre) BETWEEN 2 AND 60),
  PRIMARY KEY (servicio_id, idioma_codigo)
);

-- Antes: tipos_habitacion.servicios = 'WiFi, Piscina, Spa' (violaba la 1FN).
CREATE TABLE catalogo.hotel_servicios (
  hotel_id    uuid NOT NULL REFERENCES catalogo.hoteles (id) ON DELETE CASCADE,
  servicio_id uuid NOT NULL REFERENCES catalogo.servicios (id) ON DELETE RESTRICT,
  PRIMARY KEY (hotel_id, servicio_id)
);
CREATE INDEX hotel_servicios_servicio_idx ON catalogo.hotel_servicios (servicio_id);

CREATE TABLE catalogo.tipos_habitacion (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  hotel_id          uuid NOT NULL REFERENCES catalogo.hoteles (id) ON DELETE CASCADE,
  codigo            text NOT NULL CHECK (codigo ~ '^[a-z0-9-]{2,40}$'),
  capacidad_maxima  smallint NOT NULL CHECK (capacidad_maxima BETWEEN 1 AND 12),
  esta_activo       boolean NOT NULL DEFAULT true,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, codigo),
  UNIQUE (id, hotel_id)                 -- destino de claves foráneas que fijan el hotel
);
CREATE TRIGGER tipos_habitacion_actualizado_en BEFORE UPDATE ON catalogo.tipos_habitacion
  FOR EACH ROW EXECUTE FUNCTION public.fijar_actualizado_en();

CREATE TABLE catalogo.tipo_habitacion_traducciones (
  tipo_habitacion_id uuid NOT NULL REFERENCES catalogo.tipos_habitacion (id) ON DELETE CASCADE,
  idioma_codigo      text NOT NULL REFERENCES geo.idiomas (codigo) ON DELETE RESTRICT,
  nombre             text NOT NULL CHECK (length(nombre) BETWEEN 2 AND 80),
  descripcion        text,
  PRIMARY KEY (tipo_habitacion_id, idioma_codigo)
);

CREATE TABLE catalogo.tipo_habitacion_servicios (
  tipo_habitacion_id uuid NOT NULL REFERENCES catalogo.tipos_habitacion (id) ON DELETE CASCADE,
  servicio_id        uuid NOT NULL REFERENCES catalogo.servicios (id) ON DELETE RESTRICT,
  PRIMARY KEY (tipo_habitacion_id, servicio_id)
);
CREATE INDEX tipo_habitacion_servicios_servicio_idx ON catalogo.tipo_habitacion_servicios (servicio_id);

-- Una foto es del hotel o de una de sus habitaciones; la clave compuesta impide
-- asignarla a la habitación de otro hotel.
CREATE TABLE catalogo.fotos (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  hotel_id           uuid NOT NULL REFERENCES catalogo.hoteles (id) ON DELETE CASCADE,
  tipo_habitacion_id uuid,
  url                text NOT NULL CHECK (url ~ '^https://'),
  orden              smallint NOT NULL DEFAULT 0 CHECK (orden >= 0),
  creado_en          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tipo_habitacion_id, hotel_id)
    REFERENCES catalogo.tipos_habitacion (id, hotel_id) ON DELETE CASCADE
);
CREATE INDEX fotos_hotel_orden_idx ON catalogo.fotos (hotel_id, orden);
CREATE INDEX fotos_tipo_habitacion_idx ON catalogo.fotos (tipo_habitacion_id);

CREATE TABLE catalogo.revisiones_contenido (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  hotel_id       uuid NOT NULL REFERENCES catalogo.hoteles (id) ON DELETE CASCADE,
  estado         text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
  cambios        jsonb NOT NULL,                          -- antes y después, para mostrar la diferencia
  solicitado_por uuid NOT NULL REFERENCES identidad.usuarios (id) ON DELETE RESTRICT,
  revisado_por   uuid REFERENCES identidad.usuarios (id) ON DELETE RESTRICT,
  comentario     text,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  revisado_en    timestamptz,
  CHECK ((estado = 'pendiente') = (revisado_en IS NULL)),
  CHECK ((revisado_por IS NULL) = (revisado_en IS NULL))
);
CREATE INDEX revisiones_pendientes_idx ON catalogo.revisiones_contenido (creado_en) WHERE estado = 'pendiente';
CREATE INDEX revisiones_hotel_idx ON catalogo.revisiones_contenido (hotel_id);
