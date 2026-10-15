-- 0002 · Geografía, idiomas y monedas.

CREATE TABLE geo.idiomas (
  codigo      text PRIMARY KEY CHECK (codigo ~ '^[a-z]{2}$'),          -- ISO 639-1
  nombre      text NOT NULL,
  esta_activo boolean NOT NULL DEFAULT true
);

CREATE TABLE geo.monedas (
  codigo            char(3) PRIMARY KEY CHECK (codigo ~ '^[A-Z]{3}$'),  -- ISO 4217
  nombre            text NOT NULL,
  simbolo           text NOT NULL,
  -- Múltiplo al que se redondea el precio al público, en centavos (100 = 1 unidad).
  redondeo_centavos bigint NOT NULL CHECK (redondeo_centavos > 0)
);

CREATE TABLE geo.paises (
  codigo        char(2) PRIMARY KEY CHECK (codigo ~ '^[A-Z]{2}$'),      -- ISO 3166-1 alfa-2
  moneda_codigo char(3) NOT NULL REFERENCES geo.monedas (codigo) ON DELETE RESTRICT,
  esta_activo   boolean NOT NULL DEFAULT false                          -- visible en la web
);

CREATE TABLE geo.pais_traducciones (
  pais_codigo   char(2) NOT NULL REFERENCES geo.paises (codigo) ON DELETE CASCADE,
  idioma_codigo text NOT NULL REFERENCES geo.idiomas (codigo) ON DELETE RESTRICT,
  nombre        text NOT NULL CHECK (length(nombre) BETWEEN 2 AND 80),
  slug          text NOT NULL CHECK (slug ~ '^[a-z0-9-]{2,80}$'),
  PRIMARY KEY (pais_codigo, idioma_codigo),
  UNIQUE (idioma_codigo, slug)
);

CREATE TABLE geo.ciudades (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  pais_codigo    char(2) NOT NULL REFERENCES geo.paises (codigo) ON DELETE RESTRICT,
  latitud        numeric(9, 6) NOT NULL CHECK (latitud BETWEEN -90 AND 90),
  longitud       numeric(9, 6) NOT NULL CHECK (longitud BETWEEN -180 AND 180),
  zona_horaria   text NOT NULL,                                         -- IANA: 'America/Panama'
  esta_activa    boolean NOT NULL DEFAULT false,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ciudades_pais_idx ON geo.ciudades (pais_codigo);
CREATE TRIGGER ciudades_actualizado_en BEFORE UPDATE ON geo.ciudades
  FOR EACH ROW EXECUTE FUNCTION public.fijar_actualizado_en();

CREATE TABLE geo.ciudad_traducciones (
  ciudad_id     uuid NOT NULL REFERENCES geo.ciudades (id) ON DELETE CASCADE,
  idioma_codigo text NOT NULL REFERENCES geo.idiomas (codigo) ON DELETE RESTRICT,
  nombre        text NOT NULL CHECK (length(nombre) BETWEEN 2 AND 80),
  slug          text NOT NULL CHECK (slug ~ '^[a-z0-9-]{2,80}$'),
  descripcion   text,
  PRIMARY KEY (ciudad_id, idioma_codigo)
);
-- Autocompletado tolerante a tildes y errores: "panama", "Panamá", "Bocas".
CREATE INDEX ciudad_traducciones_nombre_trgm_idx
  ON geo.ciudad_traducciones USING gin (public.sin_acentos(nombre) gin_trgm_ops);

CREATE TABLE geo.zonas (
  id        uuid PRIMARY KEY DEFAULT uuidv7(),
  ciudad_id uuid NOT NULL REFERENCES geo.ciudades (id) ON DELETE CASCADE,
  nombre    text NOT NULL CHECK (length(nombre) BETWEEN 2 AND 80),     -- nombre propio: igual en todos los idiomas
  slug      text NOT NULL CHECK (slug ~ '^[a-z0-9-]{2,80}$'),
  UNIQUE (ciudad_id, slug)
);

CREATE TABLE geo.tipos_cambio (
  moneda_origen  char(3) NOT NULL REFERENCES geo.monedas (codigo) ON DELETE RESTRICT,
  moneda_destino char(3) NOT NULL REFERENCES geo.monedas (codigo) ON DELETE RESTRICT,
  fecha          date NOT NULL,
  tasa           numeric(18, 8) NOT NULL CHECK (tasa > 0),
  fuente         text NOT NULL,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (moneda_origen, moneda_destino, fecha),
  CHECK (moneda_origen <> moneda_destino)
);
