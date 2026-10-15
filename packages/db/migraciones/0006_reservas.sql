-- 0006 · Reservas con precio congelado por noche, anticipo, saldo e historial de estados.

CREATE TABLE reservas.reservas (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  codigo               text NOT NULL UNIQUE CHECK (codigo ~ '^WP-[A-Z0-9]{6}$'),
  hotel_id             uuid NOT NULL REFERENCES catalogo.hoteles (id) ON DELETE RESTRICT,
  usuario_id           uuid REFERENCES identidad.usuarios (id) ON DELETE SET NULL,
  estado               text NOT NULL CHECK (estado IN ('retenida', 'pendiente_pago', 'solicitada',
                         'confirmada', 'rechazada', 'expirada', 'cancelada', 'completada', 'no_show')),
  fecha_entrada        date NOT NULL,
  fecha_salida         date NOT NULL,
  idioma_codigo        text NOT NULL REFERENCES geo.idiomas (codigo) ON DELETE RESTRICT,
  moneda_codigo        char(3) NOT NULL REFERENCES geo.monedas (codigo) ON DELETE RESTRICT,
  total_venta_centavos bigint NOT NULL CHECK (total_venta_centavos > 0),
  anticipo_centavos    bigint NOT NULL CHECK (anticipo_centavos >= 0),
  saldo_centavos       bigint GENERATED ALWAYS AS (total_venta_centavos - anticipo_centavos) STORED,
  saldo_cobrado_en     timestamptz,                        -- lo marca el hotel al cobrar
  titular_nombre       text NOT NULL CHECK (length(titular_nombre) BETWEEN 2 AND 120),
  titular_correo       citext NOT NULL CHECK (titular_correo ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  titular_telefono     text NOT NULL CHECK (length(titular_telefono) BETWEEN 6 AND 30),
  titular_pais_codigo  char(2) REFERENCES geo.paises (codigo) ON DELETE RESTRICT,
  solicitudes_especiales text,
  politica_cancelacion jsonb NOT NULL,                     -- congelada al reservar
  retenida_hasta       timestamptz,
  creado_en            timestamptz NOT NULL DEFAULT now(),
  actualizado_en       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, hotel_id),
  CHECK (fecha_salida > fecha_entrada),
  CHECK (anticipo_centavos <= total_venta_centavos),
  CHECK (estado <> 'retenida' OR retenida_hasta IS NOT NULL),
  CHECK (saldo_cobrado_en IS NULL OR estado IN ('confirmada', 'completada'))
);
CREATE INDEX reservas_hotel_entrada_idx ON reservas.reservas (hotel_id, fecha_entrada);
CREATE INDEX reservas_usuario_idx ON reservas.reservas (usuario_id);
CREATE INDEX reservas_correo_idx ON reservas.reservas (titular_correo);
CREATE INDEX reservas_retenidas_idx ON reservas.reservas (retenida_hasta) WHERE estado = 'retenida';
CREATE TRIGGER reservas_actualizado_en BEFORE UPDATE ON reservas.reservas
  FOR EACH ROW EXECUTE FUNCTION public.fijar_actualizado_en();

-- hotel_id se repite para garantizar que la habitación y el plan son del hotel de la reserva.
CREATE TABLE reservas.reserva_lineas (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  reserva_id         uuid NOT NULL,
  hotel_id           uuid NOT NULL,
  tipo_habitacion_id uuid NOT NULL,
  plan_tarifa_id     uuid NOT NULL,
  cantidad           smallint NOT NULL DEFAULT 1 CHECK (cantidad BETWEEN 1 AND 20),
  adultos            smallint NOT NULL CHECK (adultos BETWEEN 1 AND 12),
  ninos              smallint NOT NULL DEFAULT 0 CHECK (ninos BETWEEN 0 AND 12),
  FOREIGN KEY (reserva_id, hotel_id) REFERENCES reservas.reservas (id, hotel_id) ON DELETE CASCADE,
  FOREIGN KEY (tipo_habitacion_id, hotel_id)
    REFERENCES catalogo.tipos_habitacion (id, hotel_id) ON DELETE RESTRICT,
  FOREIGN KEY (plan_tarifa_id, hotel_id)
    REFERENCES tarifas.planes_tarifa (id, hotel_id) ON DELETE RESTRICT
);
CREATE INDEX reserva_lineas_reserva_idx ON reservas.reserva_lineas (reserva_id);
CREATE INDEX reserva_lineas_tipo_habitacion_idx ON reservas.reserva_lineas (tipo_habitacion_id);
CREATE INDEX reserva_lineas_plan_idx ON reservas.reserva_lineas (plan_tarifa_id);

-- Precio congelado por noche: neta para el hotel + margen para WOPA = venta.
CREATE TABLE reservas.reserva_noches (
  reserva_linea_id     uuid NOT NULL REFERENCES reservas.reserva_lineas (id) ON DELETE CASCADE,
  fecha                date NOT NULL,
  monto_neto_centavos  bigint NOT NULL CHECK (monto_neto_centavos > 0),
  margen_centavos      bigint NOT NULL CHECK (margen_centavos >= 0),
  monto_venta_centavos bigint GENERATED ALWAYS AS (monto_neto_centavos + margen_centavos) STORED,
  regla_margen_id      uuid REFERENCES tarifas.reglas_margen (id) ON DELETE SET NULL,  -- trazabilidad
  PRIMARY KEY (reserva_linea_id, fecha)
);
CREATE INDEX reserva_noches_regla_idx ON reservas.reserva_noches (regla_margen_id);

CREATE TABLE reservas.historial_estados (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  reserva_id      uuid NOT NULL REFERENCES reservas.reservas (id) ON DELETE CASCADE,
  estado_anterior text,
  estado_nuevo    text NOT NULL,
  motivo          text,
  cambiado_por    uuid REFERENCES identidad.usuarios (id) ON DELETE SET NULL,  -- NULL = sistema
  creado_en       timestamptz NOT NULL DEFAULT now(),
  CHECK (estado_anterior IS DISTINCT FROM estado_nuevo)
);
CREATE INDEX historial_estados_reserva_idx ON reservas.historial_estados (reserva_id, creado_en);

-- Registra cada cambio de estado automáticamente.
CREATE FUNCTION reservas.registrar_cambio_estado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO reservas.historial_estados (reserva_id, estado_anterior, estado_nuevo)
    VALUES (NEW.id, NULL, NEW.estado);
  ELSIF NEW.estado IS DISTINCT FROM OLD.estado THEN
    INSERT INTO reservas.historial_estados (reserva_id, estado_anterior, estado_nuevo)
    VALUES (NEW.id, OLD.estado, NEW.estado);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reservas_historial AFTER INSERT OR UPDATE OF estado ON reservas.reservas
  FOR EACH ROW EXECUTE FUNCTION reservas.registrar_cambio_estado();
