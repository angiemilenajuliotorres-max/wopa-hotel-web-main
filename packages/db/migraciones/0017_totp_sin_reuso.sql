-- 0017 · Un código TOTP no se acepta dos veces: se guarda el último paso de 30 s usado.

ALTER TABLE identidad.credenciales ADD COLUMN totp_ultimo_paso bigint CHECK (totp_ultimo_paso IS NULL OR totp_ultimo_paso > 0);
