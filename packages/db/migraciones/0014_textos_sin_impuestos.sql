-- 0014 · Mientras las tasas de impuestos de hospedaje no estén validadas por un contador
-- (ver docs/POR-REVISAR.md), la ayuda no afirma que el precio incluye impuestos.

UPDATE soporte.articulo_traducciones SET contenido = replace(contenido,
  'el precio que ves es el total de la estadía con impuestos.', 'el precio que ves es el total de la estadía.')
WHERE idioma_codigo = 'es' AND slug = 'como-reservar';

UPDATE soporte.articulo_traducciones SET contenido = replace(contenido,
  'the price shown is the total for your stay, taxes included.', 'the price shown is the total for your stay.')
WHERE idioma_codigo = 'en' AND slug = 'how-to-book';
