-- 0011 · Tours y cotizaciones (lo que existe hoy) y bitácora de auditoría con alertas.

CREATE SCHEMA IF NOT EXISTS experiencias;
CREATE SCHEMA IF NOT EXISTS auditoria;

CREATE TABLE experiencias.experiencias (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  ciudad_id      uuid NOT NULL REFERENCES geo.ciudades (id) ON DELETE RESTRICT,
  codigo         text NOT NULL UNIQUE CHECK (codigo ~ '^[a-z0-9-]{2,80}$'),
  categoria      text NOT NULL CHECK (categoria IN ('cultural', 'naturaleza', 'playa', 'gastronomia', 'aventura', 'nocturna', 'otra')),
  imagen_url     text CHECK (imagen_url ~ '^https://'),
  precio_centavos bigint CHECK (precio_centavos > 0),      -- NULL = se cotiza bajo solicitud
  moneda_codigo  char(3) NOT NULL REFERENCES geo.monedas (codigo) ON DELETE RESTRICT,
  unidad_precio  text NOT NULL DEFAULT 'persona' CHECK (unidad_precio IN ('persona', 'grupo')),
  esta_activa    boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX experiencias_ciudad_idx ON experiencias.experiencias (ciudad_id) WHERE esta_activa;
CREATE TRIGGER experiencias_actualizado_en BEFORE UPDATE ON experiencias.experiencias
  FOR EACH ROW EXECUTE FUNCTION public.fijar_actualizado_en();

CREATE TABLE experiencias.experiencia_traducciones (
  experiencia_id uuid NOT NULL REFERENCES experiencias.experiencias (id) ON DELETE CASCADE,
  idioma_codigo  text NOT NULL REFERENCES geo.idiomas (codigo) ON DELETE RESTRICT,
  nombre         text NOT NULL,
  descripcion    text NOT NULL,
  duracion       text,
  PRIMARY KEY (experiencia_id, idioma_codigo)
);

CREATE TABLE experiencias.cotizaciones (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  codigo            text NOT NULL UNIQUE,
  nombre            text NOT NULL,
  correo            citext NOT NULL,
  telefono          text NOT NULL,
  idioma_codigo     text NOT NULL REFERENCES geo.idiomas (codigo) ON DELETE RESTRICT,
  moneda_codigo     char(3) NOT NULL REFERENCES geo.monedas (codigo) ON DELETE RESTRICT,
  personas          smallint NOT NULL CHECK (personas BETWEEN 1 AND 50),
  fecha_entrada     date,
  fecha_salida      date,
  notas             text,
  estado            text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviada', 'aceptada', 'descartada')),
  nota_admin        text,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  CHECK (fecha_salida IS NULL OR fecha_entrada IS NULL OR fecha_salida > fecha_entrada)
);
CREATE INDEX cotizaciones_estado_idx ON experiencias.cotizaciones (estado, creado_en);

-- Total = suma de líneas con precio (no se guarda: 3FN). Una línea sin precio vuelve la cotización parcial.
CREATE TABLE experiencias.cotizacion_lineas (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  cotizacion_id   uuid NOT NULL REFERENCES experiencias.cotizaciones (id) ON DELETE CASCADE,
  concepto        text NOT NULL CHECK (concepto IN ('hospedaje', 'experiencia')),
  hotel_id        uuid REFERENCES catalogo.hoteles (id) ON DELETE SET NULL,
  experiencia_id  uuid REFERENCES experiencias.experiencias (id) ON DELETE SET NULL,
  descripcion     text NOT NULL,
  monto_centavos  bigint CHECK (monto_centavos >= 0),     -- NULL = sin precio publicado
  CHECK (concepto = 'hospedaje' OR hotel_id IS NULL),
  CHECK (concepto = 'experiencia' OR experiencia_id IS NULL)
);
CREATE INDEX cotizacion_lineas_cotizacion_idx ON experiencias.cotizacion_lineas (cotizacion_id);
CREATE INDEX cotizacion_lineas_hotel_idx ON experiencias.cotizacion_lineas (hotel_id);
CREATE INDEX cotizacion_lineas_experiencia_idx ON experiencias.cotizacion_lineas (experiencia_id);

CREATE TABLE auditoria.eventos (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  entidad          text NOT NULL,                    -- 'hotel', 'regla_margen', 'reserva', 'pago', …
  entidad_id       text NOT NULL,
  accion           text NOT NULL,                    -- 'creado', 'aceptado', 'margen_ajustado', …
  antes            jsonb,
  despues          jsonb,
  detalle          text,
  actor_tipo       text NOT NULL CHECK (actor_tipo IN ('usuario', 'sistema', 'asistente', 'proveedor')),
  actor_usuario_id uuid REFERENCES identidad.usuarios (id) ON DELETE SET NULL,
  ip               text,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  CHECK (actor_tipo <> 'usuario' OR actor_usuario_id IS NOT NULL)
);
CREATE INDEX eventos_entidad_idx ON auditoria.eventos (entidad, entidad_id, creado_en);
CREATE INDEX eventos_fecha_idx ON auditoria.eventos (creado_en);
CREATE INDEX eventos_actor_idx ON auditoria.eventos (actor_usuario_id);

CREATE TABLE auditoria.alertas (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  tipo          text NOT NULL CHECK (tipo IN ('precio_anomalo', 'sin_cupo_prolongado', 'ticket_urgente_vencido',
                  'monto_pago_no_coincide', 'pago_pendiente_vencido', 'traducciones_faltantes', 'otra')),
  severidad     text NOT NULL CHECK (severidad IN ('info', 'advertencia', 'critica')),
  hotel_id      uuid REFERENCES catalogo.hoteles (id) ON DELETE CASCADE,
  entidad       text,
  entidad_id    text,
  detalle       jsonb NOT NULL DEFAULT '{}',
  estado        text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'atendida', 'descartada')),
  atendida_por  uuid REFERENCES identidad.usuarios (id) ON DELETE SET NULL,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  atendida_en   timestamptz,
  CHECK ((estado = 'abierta') = (atendida_en IS NULL))
);
CREATE INDEX alertas_abiertas_idx ON auditoria.alertas (creado_en) WHERE estado = 'abierta';
CREATE INDEX alertas_hotel_idx ON auditoria.alertas (hotel_id);
-- Evita alertas repetidas del mismo tipo y entidad mientras sigan abiertas.
CREATE UNIQUE INDEX alertas_abierta_unica_idx ON auditoria.alertas (tipo, entidad, entidad_id) WHERE estado = 'abierta';
