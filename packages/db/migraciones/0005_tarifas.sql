-- 0005 · Políticas, planes, tarifa neta por día, márgenes de WOPA, impuestos y cupos.

CREATE TABLE tarifas.politicas_cancelacion (
  id        uuid PRIMARY KEY DEFAULT uuidv7(),
  hotel_id  uuid NOT NULL REFERENCES catalogo.hoteles (id) ON DELETE CASCADE,
  codigo    text NOT NULL CHECK (codigo ~ '^[a-z0-9-]{2,40}$'),
  creado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, codigo),
  UNIQUE (id, hotel_id)
);

-- Penalización según los días que faltan para la llegada. Ej.: (7 días, 0 %), (0 días, 100 %).
CREATE TABLE tarifas.politica_reglas (
  politica_id        uuid NOT NULL REFERENCES tarifas.politicas_cancelacion (id) ON DELETE CASCADE,
  dias_antes_llegada smallint NOT NULL CHECK (dias_antes_llegada BETWEEN 0 AND 365),
  penalizacion_bp    integer NOT NULL CHECK (penalizacion_bp BETWEEN 0 AND 10000),
  PRIMARY KEY (politica_id, dias_antes_llegada)
);

CREATE TABLE tarifas.planes_tarifa (
  id                       uuid PRIMARY KEY DEFAULT uuidv7(),
  hotel_id                 uuid NOT NULL REFERENCES catalogo.hoteles (id) ON DELETE CASCADE,
  politica_cancelacion_id  uuid NOT NULL,
  codigo                   text NOT NULL CHECK (codigo ~ '^[a-z0-9-]{2,40}$'),
  anticipo_bp              integer NOT NULL DEFAULT 2500 CHECK (anticipo_bp BETWEEN 0 AND 10000),
  incluye_desayuno         boolean NOT NULL DEFAULT false,
  esta_activo              boolean NOT NULL DEFAULT true,
  creado_en                timestamptz NOT NULL DEFAULT now(),
  actualizado_en           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, codigo),
  UNIQUE (id, hotel_id),
  FOREIGN KEY (politica_cancelacion_id, hotel_id)
    REFERENCES tarifas.politicas_cancelacion (id, hotel_id) ON DELETE RESTRICT
);
CREATE INDEX planes_tarifa_politica_idx ON tarifas.planes_tarifa (politica_cancelacion_id);
CREATE TRIGGER planes_tarifa_actualizado_en BEFORE UPDATE ON tarifas.planes_tarifa
  FOR EACH ROW EXECUTE FUNCTION public.fijar_actualizado_en();

CREATE TABLE tarifas.plan_tarifa_traducciones (
  plan_tarifa_id uuid NOT NULL REFERENCES tarifas.planes_tarifa (id) ON DELETE CASCADE,
  idioma_codigo  text NOT NULL REFERENCES geo.idiomas (codigo) ON DELETE RESTRICT,
  nombre         text NOT NULL CHECK (length(nombre) BETWEEN 2 AND 80),
  descripcion    text,
  PRIMARY KEY (plan_tarifa_id, idioma_codigo)
);

-- Margen de WOPA, siempre por hotel (ADR-008). Se configura al aceptar el hotel y WOPA lo ajusta.
-- Ajustar = cerrar la regla vigente (vigente_hasta) e insertar otra; no se edita en el lugar.
CREATE TABLE tarifas.reglas_margen (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  hotel_id       uuid NOT NULL REFERENCES catalogo.hoteles (id) ON DELETE CASCADE,
  plan_tarifa_id uuid,                                     -- NULL = todos los planes del hotel
  tipo           text NOT NULL CHECK (tipo IN ('porcentaje', 'monto_fijo')),
  porcentaje_bp  integer CHECK (porcentaje_bp BETWEEN 0 AND 10000),   -- 3000 = 30 % sobre la neta
  monto_centavos bigint CHECK (monto_centavos >= 0),                  -- por noche, moneda del hotel
  vigente_desde  date NOT NULL,
  vigente_hasta  date,                                     -- inclusivo; NULL = sin fin
  motivo         text NOT NULL CHECK (length(motivo) >= 3),
  creado_por     uuid NOT NULL REFERENCES identidad.usuarios (id) ON DELETE RESTRICT,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (plan_tarifa_id, hotel_id)
    REFERENCES tarifas.planes_tarifa (id, hotel_id) ON DELETE CASCADE,
  CHECK ((tipo = 'porcentaje' AND porcentaje_bp IS NOT NULL AND monto_centavos IS NULL)
      OR (tipo = 'monto_fijo' AND monto_centavos IS NOT NULL AND porcentaje_bp IS NULL)),
  CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
  -- Dos reglas del mismo alcance no pueden solaparse en fechas.
  CONSTRAINT reglas_margen_sin_solape EXCLUDE USING gist (
    hotel_id WITH =,
    (coalesce(plan_tarifa_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    daterange(vigente_desde, vigente_hasta, '[]') WITH &&
  )
);
CREATE INDEX reglas_margen_plan_idx ON tarifas.reglas_margen (plan_tarifa_id);

-- Un hotel solo pasa a 'publicado' si fue aceptado y tiene un margen general vigente hoy.
CREATE FUNCTION tarifas.validar_publicacion_hotel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado = 'publicado' AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'publicado') THEN
    IF NOT EXISTS (
      SELECT 1 FROM tarifas.reglas_margen r
      WHERE r.hotel_id = NEW.id
        AND r.plan_tarifa_id IS NULL
        AND r.vigente_desde <= current_date
        AND (r.vigente_hasta IS NULL OR r.vigente_hasta >= current_date)
    ) THEN
      RAISE EXCEPTION 'El hotel % no tiene un margen vigente: configúralo al aceptarlo.', NEW.slug
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER hoteles_validar_publicacion BEFORE INSERT OR UPDATE OF estado ON catalogo.hoteles
  FOR EACH ROW EXECUTE FUNCTION tarifas.validar_publicacion_hotel();

-- Impuestos por país (o ciudad). Las tasas las valida un contador antes de cargarlas.
CREATE TABLE tarifas.impuestos (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  pais_codigo   char(2) NOT NULL REFERENCES geo.paises (codigo) ON DELETE RESTRICT,
  ciudad_id     uuid REFERENCES geo.ciudades (id) ON DELETE RESTRICT,
  codigo        text NOT NULL CHECK (codigo ~ '^[a-z0-9_]{2,40}$'),
  nombre        text NOT NULL,
  porcentaje_bp integer NOT NULL CHECK (porcentaje_bp BETWEEN 0 AND 10000),
  vigente_desde date NOT NULL,
  vigente_hasta date,
  CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
  CONSTRAINT impuestos_sin_solape EXCLUDE USING gist (
    pais_codigo WITH =,
    (coalesce(ciudad_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    codigo WITH =,
    daterange(vigente_desde, vigente_hasta, '[]') WITH &&
  )
);
CREATE INDEX impuestos_ciudad_idx ON tarifas.impuestos (ciudad_id);

-- Tarifa NETA: lo que recibe el hotel, en su moneda. El precio de venta se calcula
-- con reglas_margen (no se guarda aquí para no duplicar datos).
-- hotel_id se repite para que las claves compuestas garanticen que plan y habitación
-- pertenecen al mismo hotel.
CREATE TABLE tarifas.precios_dia (
  hotel_id            uuid NOT NULL,
  plan_tarifa_id      uuid NOT NULL,
  tipo_habitacion_id  uuid NOT NULL,
  fecha               date NOT NULL,
  ocupacion           smallint NOT NULL CHECK (ocupacion BETWEEN 1 AND 12),
  monto_neto_centavos bigint NOT NULL CHECK (monto_neto_centavos > 0),
  estancia_minima     smallint NOT NULL DEFAULT 1 CHECK (estancia_minima BETWEEN 1 AND 60),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_tarifa_id, tipo_habitacion_id, fecha, ocupacion),
  FOREIGN KEY (plan_tarifa_id, hotel_id)
    REFERENCES tarifas.planes_tarifa (id, hotel_id) ON DELETE CASCADE,
  FOREIGN KEY (tipo_habitacion_id, hotel_id)
    REFERENCES catalogo.tipos_habitacion (id, hotel_id) ON DELETE CASCADE
);
CREATE INDEX precios_dia_habitacion_fecha_idx ON tarifas.precios_dia (tipo_habitacion_id, fecha);
CREATE INDEX precios_dia_hotel_fecha_idx ON tarifas.precios_dia (hotel_id, fecha);
CREATE TRIGGER precios_dia_actualizado_en BEFORE UPDATE ON tarifas.precios_dia
  FOR EACH ROW EXECUTE FUNCTION public.fijar_actualizado_en();

CREATE TABLE tarifas.cupos_dia (
  tipo_habitacion_id uuid NOT NULL REFERENCES catalogo.tipos_habitacion (id) ON DELETE CASCADE,
  fecha              date NOT NULL,
  cupo_total         smallint NOT NULL CHECK (cupo_total >= 0),
  cupo_vendido       smallint NOT NULL DEFAULT 0 CHECK (cupo_vendido >= 0),
  esta_cerrado       boolean NOT NULL DEFAULT false,
  actualizado_en     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tipo_habitacion_id, fecha),
  CONSTRAINT cupos_dia_sin_sobreventa CHECK (cupo_vendido <= cupo_total)
);
CREATE TRIGGER cupos_dia_actualizado_en BEFORE UPDATE ON tarifas.cupos_dia
  FOR EACH ROW EXECUTE FUNCTION public.fijar_actualizado_en();
