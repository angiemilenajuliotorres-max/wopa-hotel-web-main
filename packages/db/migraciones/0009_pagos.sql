-- 0009 · Pagos: proveedores, enrutamiento por país, pagos, webhooks, reembolsos,
-- libro contable de solo inserción y liquidaciones a hoteles (ADR-006, ADR-007).

CREATE SCHEMA IF NOT EXISTS pagos;

CREATE TABLE pagos.proveedores (
  codigo      text PRIMARY KEY CHECK (codigo ~ '^[a-z0-9_]{2,40}$'),
  nombre      text NOT NULL,
  esta_activo boolean NOT NULL DEFAULT true          -- interruptor si el proveedor falla
);

CREATE TABLE pagos.reglas_enrutamiento (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  proveedor_codigo      text NOT NULL REFERENCES pagos.proveedores (codigo) ON DELETE RESTRICT,
  metodo                text NOT NULL CHECK (metodo IN ('tarjeta', 'billetera', 'transferencia', 'efectivo')),
  pais_comprador_codigo char(2) REFERENCES geo.paises (codigo) ON DELETE RESTRICT,   -- NULL = cualquiera
  pais_hotel_codigo     char(2) REFERENCES geo.paises (codigo) ON DELETE RESTRICT,   -- NULL = cualquiera
  moneda_codigo         char(3) NOT NULL REFERENCES geo.monedas (codigo) ON DELETE RESTRICT,
  prioridad             smallint NOT NULL DEFAULT 100 CHECK (prioridad BETWEEN 0 AND 1000),  -- menor = preferido
  esta_activa           boolean NOT NULL DEFAULT true,
  UNIQUE NULLS NOT DISTINCT (proveedor_codigo, metodo, pais_comprador_codigo, pais_hotel_codigo, moneda_codigo)
);
CREATE INDEX reglas_enrutamiento_moneda_idx ON pagos.reglas_enrutamiento (moneda_codigo) WHERE esta_activa;

CREATE TABLE pagos.pagos (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  reserva_id            uuid NOT NULL REFERENCES reservas.reservas (id) ON DELETE RESTRICT,
  proveedor_codigo      text NOT NULL REFERENCES pagos.proveedores (codigo) ON DELETE RESTRICT,
  metodo                text NOT NULL CHECK (metodo IN ('tarjeta', 'billetera', 'transferencia', 'efectivo')),
  concepto              text NOT NULL CHECK (concepto IN ('anticipo', 'saldo', 'total')),
  estado                text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'autorizado',
                          'capturado', 'fallido', 'cancelado', 'reembolsado_parcial', 'reembolsado')),
  monto_centavos        bigint NOT NULL CHECK (monto_centavos > 0),
  moneda_codigo         char(3) NOT NULL REFERENCES geo.monedas (codigo) ON DELETE RESTRICT,
  -- Unidades de la moneda de la reserva por unidad cobrada (1 si son iguales); congelada al cobrar.
  tasa_a_moneda_reserva numeric(18, 8) NOT NULL DEFAULT 1 CHECK (tasa_a_moneda_reserva > 0),
  referencia_externa    text,
  datos_proveedor       jsonb,                                -- redirección, QR o token (sin datos de tarjeta)
  clave_idempotencia    uuid NOT NULL UNIQUE,
  creado_en             timestamptz NOT NULL DEFAULT now(),
  actualizado_en        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proveedor_codigo, referencia_externa)
);
CREATE INDEX pagos_reserva_idx ON pagos.pagos (reserva_id);
CREATE INDEX pagos_pendientes_idx ON pagos.pagos (creado_en) WHERE estado = 'pendiente';
CREATE TRIGGER pagos_actualizado_en BEFORE UPDATE ON pagos.pagos
  FOR EACH ROW EXECUTE FUNCTION public.fijar_actualizado_en();

CREATE TABLE pagos.historial_estados (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  pago_id         uuid NOT NULL REFERENCES pagos.pagos (id) ON DELETE CASCADE,
  estado_anterior text,
  estado_nuevo    text NOT NULL,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  CHECK (estado_anterior IS DISTINCT FROM estado_nuevo)
);
CREATE INDEX pagos_historial_pago_idx ON pagos.historial_estados (pago_id, creado_en);

CREATE FUNCTION pagos.registrar_cambio_estado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.estado IS DISTINCT FROM OLD.estado THEN
    INSERT INTO pagos.historial_estados (pago_id, estado_anterior, estado_nuevo)
    VALUES (NEW.id, CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.estado END, NEW.estado);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER pagos_historial AFTER INSERT OR UPDATE OF estado ON pagos.pagos
  FOR EACH ROW EXECUTE FUNCTION pagos.registrar_cambio_estado();

-- Cada webhook se guarda una sola vez: si el proveedor lo reenvía, no se procesa dos veces.
CREATE TABLE pagos.eventos_pasarela (
  proveedor_codigo text NOT NULL REFERENCES pagos.proveedores (codigo) ON DELETE RESTRICT,
  evento_id        text NOT NULL,
  pago_id          uuid REFERENCES pagos.pagos (id) ON DELETE RESTRICT,
  tipo             text NOT NULL,
  payload          jsonb NOT NULL,
  recibido_en      timestamptz NOT NULL DEFAULT now(),
  procesado_en     timestamptz,
  PRIMARY KEY (proveedor_codigo, evento_id)
);
CREATE INDEX eventos_pasarela_pago_idx ON pagos.eventos_pasarela (pago_id);

CREATE TABLE pagos.reembolsos (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  pago_id            uuid NOT NULL REFERENCES pagos.pagos (id) ON DELETE RESTRICT,
  monto_centavos     bigint NOT NULL CHECK (monto_centavos > 0),
  motivo             text NOT NULL,
  estado             text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'completado', 'fallido')),
  referencia_externa text,
  solicitado_por     uuid REFERENCES identidad.usuarios (id) ON DELETE RESTRICT,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  completado_en      timestamptz,
  CHECK ((estado = 'completado') = (completado_en IS NOT NULL))
);
CREATE INDEX reembolsos_pago_idx ON pagos.reembolsos (pago_id);

CREATE TABLE pagos.liquidaciones (
  id                       uuid PRIMARY KEY DEFAULT uuidv7(),
  hotel_id                 uuid NOT NULL REFERENCES catalogo.hoteles (id) ON DELETE RESTRICT,
  periodo_desde            date NOT NULL,
  periodo_hasta            date NOT NULL,
  moneda_codigo            char(3) NOT NULL REFERENCES geo.monedas (codigo) ON DELETE RESTRICT,
  estado                   text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'aprobada', 'pagada')),
  referencia_transferencia text,
  creado_por               uuid NOT NULL REFERENCES identidad.usuarios (id) ON DELETE RESTRICT,
  aprobado_por             uuid REFERENCES identidad.usuarios (id) ON DELETE RESTRICT,
  creado_en                timestamptz NOT NULL DEFAULT now(),
  pagado_en                timestamptz,
  UNIQUE (hotel_id, periodo_desde),
  CHECK (periodo_hasta >= periodo_desde),
  CHECK (estado = 'borrador' OR aprobado_por IS NOT NULL),
  CHECK ((estado = 'pagada') = (pagado_en IS NOT NULL AND referencia_transferencia IS NOT NULL))
);

-- Cada reserva se liquida una sola vez. El total de la liquidación es la suma de sus líneas (no se guarda: 3FN).
CREATE TABLE pagos.liquidacion_lineas (
  liquidacion_id uuid NOT NULL REFERENCES pagos.liquidaciones (id) ON DELETE CASCADE,
  reserva_id     uuid NOT NULL UNIQUE REFERENCES reservas.reservas (id) ON DELETE RESTRICT,
  monto_centavos bigint NOT NULL CHECK (monto_centavos >= 0),
  PRIMARY KEY (liquidacion_id, reserva_id)
);

-- Libro contable de partida doble y solo inserción (reemplaza movimientos_financieros).
-- Los asientos de una misma operación (operacion_id) deben sumar cero; se corrige con operaciones nuevas.
CREATE TABLE pagos.asientos (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  operacion_id   uuid NOT NULL,
  cuenta         text NOT NULL CHECK (cuenta IN ('caja_proveedor', 'por_pagar_hotel', 'ingreso_margen',
                   'ingreso_penalizacion', 'comision_pasarela', 'reembolso_cliente', 'gasto_operativo', 'ingreso_otro')),
  monto_centavos bigint NOT NULL CHECK (monto_centavos <> 0),       -- + débito / − crédito
  moneda_codigo  char(3) NOT NULL REFERENCES geo.monedas (codigo) ON DELETE RESTRICT,
  fecha          date NOT NULL DEFAULT current_date,
  descripcion    text NOT NULL,
  pago_id        uuid REFERENCES pagos.pagos (id) ON DELETE RESTRICT,
  reserva_id     uuid REFERENCES reservas.reservas (id) ON DELETE RESTRICT,
  liquidacion_id uuid REFERENCES pagos.liquidaciones (id) ON DELETE RESTRICT,
  creado_por     uuid REFERENCES identidad.usuarios (id) ON DELETE RESTRICT,   -- NULL = sistema
  creado_en      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX asientos_operacion_idx ON pagos.asientos (operacion_id);
CREATE INDEX asientos_fecha_cuenta_idx ON pagos.asientos (fecha, cuenta);
CREATE INDEX asientos_pago_idx ON pagos.asientos (pago_id);
CREATE INDEX asientos_reserva_idx ON pagos.asientos (reserva_id);
CREATE INDEX asientos_liquidacion_idx ON pagos.asientos (liquidacion_id);

CREATE FUNCTION pagos.prohibir_cambios_asientos() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Los asientos contables no se editan ni se borran: registra un asiento de corrección.'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
CREATE TRIGGER asientos_solo_insercion BEFORE UPDATE OR DELETE ON pagos.asientos
  FOR EACH ROW EXECUTE FUNCTION pagos.prohibir_cambios_asientos();

-- Se revisa al confirmar la transacción: cada operación debe cuadrar en cada moneda.
CREATE FUNCTION pagos.validar_operacion_cuadrada() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  descuadre bigint;
BEGIN
  SELECT coalesce(sum(monto_centavos), 0) INTO descuadre
  FROM pagos.asientos
  WHERE operacion_id = NEW.operacion_id AND moneda_codigo = NEW.moneda_codigo;
  IF descuadre <> 0 THEN
    RAISE EXCEPTION 'La operación contable % no cuadra: descuadre de % centavos en %.',
      NEW.operacion_id, descuadre, NEW.moneda_codigo USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER asientos_operacion_cuadrada AFTER INSERT ON pagos.asientos
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION pagos.validar_operacion_cuadrada();

-- Proveedores y reglas del lanzamiento en Panamá (ADR-006). 'simulado' solo se activa fuera de producción.
INSERT INTO pagos.proveedores (codigo, nombre, esta_activo) VALUES
  ('simulado', 'Pasarela simulada (desarrollo)', true),
  ('yappy', 'Yappy Comercial · Banco General', false),
  ('paguelofacil', 'PagueloFacil', false),
  ('paypal', 'PayPal', false);

INSERT INTO pagos.reglas_enrutamiento (proveedor_codigo, metodo, pais_comprador_codigo, moneda_codigo, prioridad) VALUES
  ('yappy', 'billetera', 'PA', 'USD', 10),
  ('paguelofacil', 'tarjeta', NULL, 'USD', 20),
  ('paypal', 'billetera', NULL, 'USD', 50),
  ('simulado', 'tarjeta', NULL, 'USD', 900),
  ('simulado', 'billetera', NULL, 'USD', 900);
