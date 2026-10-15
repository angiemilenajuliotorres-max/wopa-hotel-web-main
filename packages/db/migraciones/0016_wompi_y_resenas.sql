-- 0016 · Expansión (fase 6): Wompi para Colombia en COP y reseñas verificadas.

INSERT INTO pagos.proveedores (codigo, nombre, esta_activo) VALUES ('wompi', 'Wompi · Bancolombia', false);

-- Hoteles colombianos con tarifas en COP: tarjeta, PSE (transferencia) y Nequi (billetera).
INSERT INTO pagos.reglas_enrutamiento (proveedor_codigo, metodo, pais_hotel_codigo, moneda_codigo, prioridad) VALUES
  ('wompi', 'tarjeta', 'CO', 'COP', 10),
  ('wompi', 'transferencia', 'CO', 'COP', 10),
  ('wompi', 'billetera', 'CO', 'COP', 10),
  ('simulado', 'tarjeta', NULL, 'COP', 900),
  ('simulado', 'transferencia', NULL, 'COP', 900);

-- Reseñas: solo de estadías completadas, una por reserva, con moderación de WOPA antes de publicarse.
CREATE TABLE reservas.resenas (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  reserva_id     uuid NOT NULL UNIQUE REFERENCES reservas.reservas (id) ON DELETE CASCADE,
  hotel_id       uuid NOT NULL REFERENCES catalogo.hoteles (id) ON DELETE CASCADE,
  puntaje        smallint NOT NULL CHECK (puntaje BETWEEN 1 AND 5),
  comentario     text CHECK (comentario IS NULL OR length(comentario) BETWEEN 10 AND 2000),
  idioma_codigo  text NOT NULL REFERENCES geo.idiomas (codigo) ON DELETE RESTRICT,
  nombre_visible text NOT NULL CHECK (length(nombre_visible) BETWEEN 2 AND 60),
  estado         text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'publicada', 'rechazada')),
  moderada_por   uuid REFERENCES identidad.usuarios (id) ON DELETE SET NULL,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  moderada_en    timestamptz,
  CHECK ((estado = 'pendiente') = (moderada_en IS NULL))
);
CREATE INDEX resenas_hotel_publicadas_idx ON reservas.resenas (hotel_id, creado_en) WHERE estado = 'publicada';
CREATE INDEX resenas_pendientes_idx ON reservas.resenas (creado_en) WHERE estado = 'pendiente';

-- Solo se puede reseñar una reserva completada del mismo hotel.
CREATE FUNCTION reservas.validar_resena() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM reservas.reservas r WHERE r.id = NEW.reserva_id AND r.hotel_id = NEW.hotel_id AND r.estado = 'completada') THEN
    RAISE EXCEPTION 'Solo se reseñan estadías completadas.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER resenas_validar BEFORE INSERT ON reservas.resenas FOR EACH ROW EXECUTE FUNCTION reservas.validar_resena();

-- Correo de invitación a reseñar: una sola vez por reserva.
ALTER TABLE reservas.reservas ADD COLUMN resena_solicitada_en timestamptz;
