-- 0001 · Extensiones, esquemas por módulo y funciones comunes.
-- Requiere PostgreSQL 18 (uuidv7() nativo). Ver docs/arquitectura/03-base-de-datos.md.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS geo;
CREATE SCHEMA IF NOT EXISTS identidad;
CREATE SCHEMA IF NOT EXISTS catalogo;
CREATE SCHEMA IF NOT EXISTS tarifas;
CREATE SCHEMA IF NOT EXISTS reservas;

-- Mantiene actualizado_en en cada UPDATE.
CREATE FUNCTION public.fijar_actualizado_en() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END;
$$;

-- unaccent no es IMMUTABLE; esta envoltura permite usarla en índices de búsqueda.
CREATE FUNCTION public.sin_acentos(texto text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
RETURN public.unaccent('public.unaccent'::regdictionary, texto);
