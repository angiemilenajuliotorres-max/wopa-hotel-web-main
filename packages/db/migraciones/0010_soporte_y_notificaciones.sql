-- 0010 · Asistente con IA, tickets, centro de ayuda (ADR-009) y bandeja de correos salientes.

CREATE SCHEMA IF NOT EXISTS soporte;
CREATE SCHEMA IF NOT EXISTS notificaciones;

-- El chat lo atiende solo la IA. Sumar agentes humanos es una migración futura
-- (estados 'en_cola' y 'con_agente', columna agente_id).
CREATE TABLE soporte.conversaciones (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  canal           text NOT NULL DEFAULT 'web' CHECK (canal IN ('web')),
  estado          text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'escalada_a_ticket', 'cerrada')),
  idioma_codigo   text NOT NULL REFERENCES geo.idiomas (codigo) ON DELETE RESTRICT,
  usuario_id      uuid REFERENCES identidad.usuarios (id) ON DELETE SET NULL,
  reserva_id      uuid REFERENCES reservas.reservas (id) ON DELETE SET NULL,
  contacto_correo citext,
  ip              text,
  resumen         text,
  valoracion      smallint CHECK (valoracion BETWEEN 1 AND 5),
  creado_en       timestamptz NOT NULL DEFAULT now(),
  cerrado_en      timestamptz,
  CHECK ((estado = 'cerrada') = (cerrado_en IS NOT NULL))
);
CREATE INDEX conversaciones_creado_idx ON soporte.conversaciones (creado_en);
CREATE INDEX conversaciones_reserva_idx ON soporte.conversaciones (reserva_id);
CREATE INDEX conversaciones_usuario_idx ON soporte.conversaciones (usuario_id);

CREATE TABLE soporte.mensajes (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  conversacion_id uuid NOT NULL REFERENCES soporte.conversaciones (id) ON DELETE CASCADE,
  autor           text NOT NULL CHECK (autor IN ('cliente', 'asistente', 'sistema')),
  contenido       text NOT NULL CHECK (length(contenido) BETWEEN 1 AND 8000),
  herramientas    jsonb,                                   -- llamadas a herramientas del asistente (auditoría)
  creado_en       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mensajes_conversacion_idx ON soporte.mensajes (conversacion_id, creado_en);

CREATE TABLE soporte.categorias (
  codigo    text PRIMARY KEY CHECK (codigo ~ '^[a-z_]{2,40}$'),
  sla_horas smallint NOT NULL CHECK (sla_horas > 0)
);

CREATE TABLE soporte.categoria_traducciones (
  categoria_codigo text NOT NULL REFERENCES soporte.categorias (codigo) ON DELETE CASCADE,
  idioma_codigo    text NOT NULL REFERENCES geo.idiomas (codigo) ON DELETE RESTRICT,
  nombre           text NOT NULL,
  PRIMARY KEY (categoria_codigo, idioma_codigo)
);

CREATE TABLE soporte.tickets (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  codigo             text NOT NULL UNIQUE CHECK (codigo ~ '^TK-[0-9]{6}$'),
  categoria_codigo   text NOT NULL REFERENCES soporte.categorias (codigo) ON DELETE RESTRICT,
  prioridad          text NOT NULL DEFAULT 'media' CHECK (prioridad IN ('baja', 'media', 'alta', 'urgente')),
  estado             text NOT NULL DEFAULT 'abierto'
                     CHECK (estado IN ('abierto', 'en_progreso', 'esperando_cliente', 'resuelto', 'cerrado')),
  origen             text NOT NULL CHECK (origen IN ('asistente', 'mi_reserva', 'contacto', 'extranet', 'correo', 'legado')),
  asunto             text NOT NULL CHECK (length(asunto) BETWEEN 3 AND 200),
  idioma_codigo      text NOT NULL REFERENCES geo.idiomas (codigo) ON DELETE RESTRICT,
  solicitante_nombre text NOT NULL,
  solicitante_correo citext NOT NULL,
  solicitante_telefono text,
  conversacion_id    uuid REFERENCES soporte.conversaciones (id) ON DELETE SET NULL,
  reserva_id         uuid REFERENCES reservas.reservas (id) ON DELETE SET NULL,
  hotel_id           uuid REFERENCES catalogo.hoteles (id) ON DELETE SET NULL,
  asignado_a         uuid REFERENCES identidad.usuarios (id) ON DELETE SET NULL,
  vence_sla_en       timestamptz NOT NULL,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  actualizado_en     timestamptz NOT NULL DEFAULT now(),
  resuelto_en        timestamptz,
  CHECK (resuelto_en IS NULL OR resuelto_en >= creado_en),
  CHECK ((estado IN ('resuelto', 'cerrado')) = (resuelto_en IS NOT NULL))
);
CREATE INDEX tickets_abiertos_sla_idx ON soporte.tickets (vence_sla_en) WHERE estado IN ('abierto', 'en_progreso');
CREATE INDEX tickets_reserva_idx ON soporte.tickets (reserva_id);
CREATE INDEX tickets_hotel_idx ON soporte.tickets (hotel_id);
CREATE INDEX tickets_asignado_idx ON soporte.tickets (asignado_a);
CREATE INDEX tickets_conversacion_idx ON soporte.tickets (conversacion_id);
CREATE TRIGGER tickets_actualizado_en BEFORE UPDATE ON soporte.tickets
  FOR EACH ROW EXECUTE FUNCTION public.fijar_actualizado_en();

CREATE TABLE soporte.ticket_mensajes (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  ticket_id      uuid NOT NULL REFERENCES soporte.tickets (id) ON DELETE CASCADE,
  autor          text NOT NULL CHECK (autor IN ('cliente', 'equipo', 'sistema')),
  autor_usuario_id uuid REFERENCES identidad.usuarios (id) ON DELETE SET NULL,
  contenido      text NOT NULL CHECK (length(contenido) BETWEEN 1 AND 8000),
  es_nota_interna boolean NOT NULL DEFAULT false,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT es_nota_interna OR autor = 'equipo')
);
CREATE INDEX ticket_mensajes_ticket_idx ON soporte.ticket_mensajes (ticket_id, creado_en);

CREATE TABLE soporte.historial_estados (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  ticket_id       uuid NOT NULL REFERENCES soporte.tickets (id) ON DELETE CASCADE,
  estado_anterior text,
  estado_nuevo    text NOT NULL,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  CHECK (estado_anterior IS DISTINCT FROM estado_nuevo)
);
CREATE INDEX soporte_historial_ticket_idx ON soporte.historial_estados (ticket_id, creado_en);

CREATE FUNCTION soporte.registrar_cambio_estado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.estado IS DISTINCT FROM OLD.estado THEN
    INSERT INTO soporte.historial_estados (ticket_id, estado_anterior, estado_nuevo)
    VALUES (NEW.id, CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.estado END, NEW.estado);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tickets_historial AFTER INSERT OR UPDATE OF estado ON soporte.tickets
  FOR EACH ROW EXECUTE FUNCTION soporte.registrar_cambio_estado();

CREATE TABLE soporte.articulos_ayuda (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  codigo      text NOT NULL UNIQUE CHECK (codigo ~ '^[a-z0-9-]{2,60}$'),
  orden       smallint NOT NULL DEFAULT 0,
  esta_publicado boolean NOT NULL DEFAULT true,
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER articulos_ayuda_actualizado_en BEFORE UPDATE ON soporte.articulos_ayuda
  FOR EACH ROW EXECUTE FUNCTION public.fijar_actualizado_en();

CREATE TABLE soporte.articulo_traducciones (
  articulo_id   uuid NOT NULL REFERENCES soporte.articulos_ayuda (id) ON DELETE CASCADE,
  idioma_codigo text NOT NULL REFERENCES geo.idiomas (codigo) ON DELETE RESTRICT,
  slug          text NOT NULL CHECK (slug ~ '^[a-z0-9-]{2,80}$'),
  titulo        text NOT NULL,
  contenido     text NOT NULL,
  PRIMARY KEY (articulo_id, idioma_codigo),
  UNIQUE (idioma_codigo, slug)
);
CREATE INDEX articulo_traducciones_busqueda_idx ON soporte.articulo_traducciones
  USING gin (public.sin_acentos(titulo || ' ' || contenido) gin_trgm_ops);

-- Bandeja de salida: los correos se encolan y un proceso los envía (o los simula sin proveedor).
CREATE TABLE notificaciones.correos (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  para           citext NOT NULL,
  asunto         text NOT NULL,
  cuerpo_texto   text NOT NULL,
  cuerpo_html    text,
  plantilla      text NOT NULL,
  idioma_codigo  text NOT NULL REFERENCES geo.idiomas (codigo) ON DELETE RESTRICT,
  estado         text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviado', 'simulado', 'fallido')),
  intentos       smallint NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  ultimo_error   text,
  proveedor_id   text,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  enviado_en     timestamptz
);
CREATE INDEX correos_pendientes_idx ON notificaciones.correos (creado_en) WHERE estado = 'pendiente';

INSERT INTO soporte.categorias (codigo, sla_horas) VALUES
  ('en_el_hotel', 1), ('pago', 4), ('cancelacion', 4), ('reserva', 24), ('cuenta_hotel', 24), ('otro', 24);

INSERT INTO soporte.categoria_traducciones (categoria_codigo, idioma_codigo, nombre) VALUES
  ('en_el_hotel', 'es', 'Problema en el hotel'), ('en_el_hotel', 'en', 'Issue at the hotel'),
  ('pago', 'es', 'Pagos y reembolsos'), ('pago', 'en', 'Payments and refunds'),
  ('cancelacion', 'es', 'Cancelaciones'), ('cancelacion', 'en', 'Cancellations'),
  ('reserva', 'es', 'Reservas'), ('reserva', 'en', 'Bookings'),
  ('cuenta_hotel', 'es', 'Cuenta de hotel'), ('cuenta_hotel', 'en', 'Hotel account'),
  ('otro', 'es', 'Otro'), ('otro', 'en', 'Other');
