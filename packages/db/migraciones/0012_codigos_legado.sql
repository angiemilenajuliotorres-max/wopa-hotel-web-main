-- 0012 · Acepta los códigos de reserva de la web heredada (WOPA-R-<16 hex>) al importarlos.
-- Las reservas nuevas siguen usando WP-XXXXXX.

ALTER TABLE reservas.reservas DROP CONSTRAINT reservas_codigo_check;
ALTER TABLE reservas.reservas ADD CONSTRAINT reservas_codigo_check
  CHECK (codigo ~ '^(WP-[A-Z0-9]{6}|WOPA-R-[A-F0-9]{16})$');
