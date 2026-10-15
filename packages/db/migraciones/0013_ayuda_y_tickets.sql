-- 0013 · Numeración segura de tickets y artículos iniciales del centro de ayuda (es/en).

CREATE SEQUENCE soporte.tickets_numero_seq START 1;
-- Los tickets importados ya usaron números: la secuencia continúa después del mayor.
SELECT setval('soporte.tickets_numero_seq',
  greatest(1, coalesce((SELECT max(substr(codigo, 4)::int) FROM soporte.tickets), 0)),
  (SELECT count(*) > 0 FROM soporte.tickets));

WITH articulos (codigo, orden, slug_es, titulo_es, contenido_es, slug_en, titulo_en, contenido_en) AS (
  VALUES
  ('como-reservar', 1,
   'como-reservar', '¿Cómo reservo un hotel?',
   E'1. Busca tu destino, elige las fechas y la cantidad de huéspedes.\n2. Compara los hoteles: el precio que ves es el total de la estadía con impuestos.\n3. Elige la habitación y completa tus datos.\n4. Paga el anticipo en línea. El resto lo pagas en el hotel al llegar.\n\nRecibirás un correo con tu código de reserva. Con ese código y tu correo puedes consultar o cancelar tu reserva en "Mi reserva".',
   'how-to-book', 'How do I book a hotel?',
   E'1. Search for your destination, pick your dates and number of guests.\n2. Compare hotels: the price shown is the total for your stay, taxes included.\n3. Choose a room and enter your details.\n4. Pay the deposit online. You pay the rest at the hotel on arrival.\n\nYou''ll get an email with your booking code. Use it with your email in "My booking" to check or cancel your booking.'),
  ('anticipo-y-saldo', 2,
   'anticipo-y-saldo', '¿Qué es el anticipo y cuándo pago el resto?',
   E'Para confirmar tu reserva pagas un anticipo en línea, normalmente el 25 % del total. El saldo lo pagas directamente en el hotel cuando llegas.\n\nEn el resumen de tu reserva siempre verás separado lo que pagas hoy y lo que pagas en el hotel.',
   'deposit-and-balance', 'What is the deposit and when do I pay the rest?',
   E'To confirm your booking you pay a deposit online, usually 25% of the total. You pay the balance directly at the hotel when you arrive.\n\nYour booking summary always shows what you pay today and what you pay at the hotel.'),
  ('cancelar', 3,
   'cancelar-una-reserva', '¿Cómo cancelo y cuánto me devuelven?',
   E'Entra en "Mi reserva" con tu código y tu correo y pulsa "Cancelar reserva".\n\nCada hotel tiene su política. En la ficha y en tu confirmación verás hasta qué fecha la cancelación es gratis. Si cancelas después, se retiene la parte que indique la política, nunca más de lo que pagaste.',
   'cancel-a-booking', 'How do I cancel and how much is refunded?',
   E'Go to "My booking" with your code and email and select "Cancel booking".\n\nEach hotel has its own policy. The hotel page and your confirmation show the date until which cancellation is free. If you cancel later, the amount stated in the policy is kept, never more than what you paid.'),
  ('metodos-de-pago', 4,
   'metodos-de-pago', '¿Qué métodos de pago aceptan?',
   E'Tarjetas de crédito y débito, y Yappy para clientes en Panamá. Los métodos disponibles dependen de tu país y aparecen al pagar.\n\nWOPA Travel nunca guarda los datos de tu tarjeta: el pago se procesa en la página segura del proveedor.',
   'payment-methods', 'Which payment methods do you accept?',
   E'Credit and debit cards, and Yappy for customers in Panama. Available methods depend on your country and are shown at checkout.\n\nWOPA Travel never stores your card details: payments are processed on the provider''s secure page.'),
  ('solicitud', 5,
   'reserva-bajo-solicitud', '¿Qué significa "bajo solicitud"?',
   E'Algunos hoteles confirman la disponibilidad manualmente. En ese caso envías la solicitud sin pagar nada; cuando el hotel la acepta, te enviamos un enlace para pagar el anticipo en 48 horas.',
   'on-request-booking', 'What does "on request" mean?',
   E'Some hotels confirm availability manually. You send the request without paying anything; once the hotel accepts it, we send you a link to pay the deposit within 48 hours.')
),
insertados AS (
  INSERT INTO soporte.articulos_ayuda (codigo, orden) SELECT codigo, orden FROM articulos RETURNING id, codigo
)
INSERT INTO soporte.articulo_traducciones (articulo_id, idioma_codigo, slug, titulo, contenido)
SELECT i.id, t.idioma, t.slug, t.titulo, t.contenido
FROM insertados i JOIN articulos a USING (codigo)
CROSS JOIN LATERAL (VALUES ('es', a.slug_es, a.titulo_es, a.contenido_es), ('en', a.slug_en, a.titulo_en, a.contenido_en)) AS t (idioma, slug, titulo, contenido);
