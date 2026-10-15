# 01 · Visión y alcance

## Producto

Plataforma de reservas de hoteles organizada por **país → ciudad → zona**. WOPA da de alta a cada hotel, le entrega el acceso y supervisa su actividad. El viajero busca, compara y **paga el anticipo en la web**, en español o inglés. Un asistente con IA lo ayuda a cualquier hora.

## Públicos

| Público | Necesita | Dónde trabaja |
|---|---|---|
| Viajero | Encontrar hotel, ver el precio total, pagar el anticipo con métodos de su país, pedir ayuda | Web pública `/es`, `/en` |
| Hotelero | Completar su ficha, cargar la tarifa neta y los cupos por fecha, ver reservas y liquidaciones | Extranet `/[locale]/extranet` |
| Equipo WOPA | Crear y aceptar hoteles, configurar márgenes, supervisar, resolver tickets, cobrar y liquidar | Panel `/admin` |

## Lanzamiento: Panamá

Ver [ADR-001](../decisiones.md).

| Tema | Lanzamiento | Después |
|---|---|---|
| Operación y cobro | Empresa panameña, cobro en USD | Cobro en moneda local por país |
| Destinos | Hoteles en Panamá + catálogo actual de Cartagena | Más ciudades y países |
| Pagos | Yappy + PagueloFacil (PayPal opcional) | Wompi o PayU para Colombia |
| Idiomas | Español e inglés | Según el tráfico |
| Soporte | Asistente con IA 24/7 + tickets | Agentes humanos, WhatsApp |

## Recorrido del viajero

1. Inicio o página de destino con buscador (destino, fechas, huéspedes).
2. Resultados con el precio total con impuestos, filtros y mapa.
3. Ficha del hotel: galería, habitaciones, qué incluye y política de cancelación con fecha concreta.
4. Datos del huésped. La habitación queda retenida 15 minutos.
5. Pago del anticipo, con “Pagas hoy” y “Pagas en el hotel” separados.
6. Confirmación por correo, PDF y “Mi reserva” (código + correo).

## Alta de un hotel

1. WOPA crea la organización y el hotel (país, ciudad, ubicación, moneda).
2. WOPA invita al responsable del hotel (enlace válido 72 h).
3. El hotel activa su cuenta con verificación en dos pasos.
4. El hotel completa la ficha, las fotos, las habitaciones y su tarifa neta.
5. WOPA **acepta** el hotel y **configura su margen**. Sin margen no se puede publicar.
6. WOPA ajusta los márgenes cuando lo necesite. Los cambios no afectan las reservas hechas.

## Principios de interfaz

- Precio total con impuestos desde el listado.
- Lo que se paga hoy y lo que se paga en el hotel, siempre separados.
- Primero el móvil, zonas táctiles de al menos 44 px y WCAG 2.2 AA.
- Idioma y moneda en la cabecera, sin redirecciones forzadas.
- Botón de ayuda siempre visible.
