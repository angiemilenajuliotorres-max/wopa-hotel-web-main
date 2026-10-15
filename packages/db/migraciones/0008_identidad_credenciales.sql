-- 0008 · Credenciales, sesiones e intentos de acceso.
-- Corrige 0003: usuarios.tiene_2fa duplicaba el dato de credenciales.totp_activado_en (3FN).

ALTER TABLE identidad.usuarios DROP COLUMN tiene_2fa;

CREATE TABLE identidad.credenciales (
  usuario_id           uuid PRIMARY KEY REFERENCES identidad.usuarios (id) ON DELETE CASCADE,
  clave_hash           text NOT NULL CHECK (clave_hash LIKE 'scrypt$%'),  -- nunca la clave en claro
  totp_secreto_cifrado text,                                              -- AES-256-GCM, clave en SECRETO_CIFRADO
  totp_activado_en     timestamptz,
  actualizado_en       timestamptz NOT NULL DEFAULT now(),
  CHECK (totp_activado_en IS NULL OR totp_secreto_cifrado IS NOT NULL)
);
CREATE TRIGGER credenciales_actualizado_en BEFORE UPDATE ON identidad.credenciales
  FOR EACH ROW EXECUTE FUNCTION public.fijar_actualizado_en();

CREATE TABLE identidad.sesiones (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  usuario_id          uuid NOT NULL REFERENCES identidad.usuarios (id) ON DELETE CASCADE,
  token_hash          text NOT NULL UNIQUE,                 -- sha256 del token de la cookie
  segundo_factor_ok   boolean NOT NULL DEFAULT false,
  ip                  text,
  agente              text,
  creada_en           timestamptz NOT NULL DEFAULT now(),
  ultima_actividad_en timestamptz NOT NULL DEFAULT now(),
  expira_en           timestamptz NOT NULL,
  revocada_en         timestamptz,
  CHECK (expira_en > creada_en)
);
CREATE INDEX sesiones_usuario_idx ON identidad.sesiones (usuario_id);
CREATE INDEX sesiones_vigentes_idx ON identidad.sesiones (expira_en) WHERE revocada_en IS NULL;

-- Para bloquear la fuerza bruta por correo e IP sin depender de memoria del servidor.
CREATE TABLE identidad.intentos_acceso (
  id        uuid PRIMARY KEY DEFAULT uuidv7(),
  correo    citext NOT NULL,
  ip        text,
  exito     boolean NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX intentos_acceso_correo_idx ON identidad.intentos_acceso (correo, creado_en);
CREATE INDEX intentos_acceso_ip_idx ON identidad.intentos_acceso (ip, creado_en);
