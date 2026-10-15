-- 0015 · Historial exacto de la API para el asistente con IA (ADR-009).
-- Se guarda tal como lo devuelve la API (incluidos los bloques de razonamiento) y solo se agrega al final:
-- editar turnos anteriores invalidaría el razonamiento de los modelos actuales.

ALTER TABLE soporte.conversaciones ADD COLUMN historial_api jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE soporte.conversaciones ADD COLUMN modo text NOT NULL DEFAULT 'ia' CHECK (modo IN ('ia', 'sin_ia'));
CREATE INDEX conversaciones_ip_idx ON soporte.conversaciones (ip, creado_en);
