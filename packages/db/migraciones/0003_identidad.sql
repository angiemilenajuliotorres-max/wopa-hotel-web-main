-- 0003 · Usuarios, organizaciones (WOPA u hotel), membresías con rol e invitaciones.
-- Las sesiones y credenciales las gestionará la librería de autenticación (fase 1, pendiente).

CREATE TABLE identidad.usuarios (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  correo         citext NOT NULL UNIQUE CHECK (correo ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  nombre         text NOT NULL CHECK (length(nombre) BETWEEN 2 AND 120),
  idioma_codigo  text NOT NULL DEFAULT 'es' REFERENCES geo.idiomas (codigo) ON DELETE RESTRICT,
  esta_activo    boolean NOT NULL DEFAULT true,
  tiene_2fa      boolean NOT NULL DEFAULT false,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER usuarios_actualizado_en BEFORE UPDATE ON identidad.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.fijar_actualizado_en();

CREATE TABLE identidad.organizaciones (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  nombre         text NOT NULL CHECK (length(nombre) BETWEEN 2 AND 120),
  tipo           text NOT NULL CHECK (tipo IN ('wopa', 'hotel')),
  esta_activa    boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tipo)                     -- destino de claves foráneas que fijan el tipo
);
CREATE TRIGGER organizaciones_actualizado_en BEFORE UPDATE ON identidad.organizaciones
  FOR EACH ROW EXECUTE FUNCTION public.fijar_actualizado_en();

-- organizacion_tipo repite el tipo para que la base garantice que los roles wopa_*
-- solo existan en la organización WOPA y los roles hotel_* solo en hoteles.
CREATE TABLE identidad.membresias (
  usuario_id        uuid NOT NULL REFERENCES identidad.usuarios (id) ON DELETE CASCADE,
  organizacion_id   uuid NOT NULL,
  organizacion_tipo text NOT NULL,
  rol               text NOT NULL CHECK (rol IN ('wopa_admin', 'wopa_operaciones', 'wopa_soporte',
                      'wopa_finanzas', 'hotel_admin', 'hotel_recepcion')),
  creado_en         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, organizacion_id),
  FOREIGN KEY (organizacion_id, organizacion_tipo)
    REFERENCES identidad.organizaciones (id, tipo) ON DELETE CASCADE ON UPDATE CASCADE,
  CHECK ((organizacion_tipo = 'wopa' AND rol LIKE 'wopa\_%')
      OR (organizacion_tipo = 'hotel' AND rol LIKE 'hotel\_%'))
);
CREATE INDEX membresias_organizacion_idx ON identidad.membresias (organizacion_id);

CREATE TABLE identidad.invitaciones (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  organizacion_id   uuid NOT NULL,
  organizacion_tipo text NOT NULL,
  correo            citext NOT NULL,
  rol               text NOT NULL,
  token_hash        text NOT NULL UNIQUE,                 -- nunca se guarda el token en claro
  expira_en         timestamptz NOT NULL,
  aceptada_en       timestamptz,
  creado_por        uuid NOT NULL REFERENCES identidad.usuarios (id) ON DELETE RESTRICT,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organizacion_id, organizacion_tipo)
    REFERENCES identidad.organizaciones (id, tipo) ON DELETE CASCADE ON UPDATE CASCADE,
  CHECK ((organizacion_tipo = 'wopa' AND rol LIKE 'wopa\_%')
      OR (organizacion_tipo = 'hotel' AND rol LIKE 'hotel\_%')),
  CHECK (expira_en > creado_en),
  CHECK (aceptada_en IS NULL OR aceptada_en <= expira_en)
);
CREATE INDEX invitaciones_organizacion_idx ON identidad.invitaciones (organizacion_id);
CREATE INDEX invitaciones_pendientes_idx ON identidad.invitaciones (correo) WHERE aceptada_en IS NULL;
