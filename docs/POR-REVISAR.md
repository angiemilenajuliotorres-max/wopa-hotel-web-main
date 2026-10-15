# Lista por revisar

Lo que necesita una persona: decisiones, cuentas, accesos o validaciones que el código no puede resolver solo. Se actualiza en cada PR. Cuando un ítem se resuelve, se marca ✅ con la fecha.

Prioridad: 🔴 bloquea el lanzamiento · 🟠 necesario antes de producción · 🟢 mejora

## Cuentas y credenciales (los servicios funcionan hoy con simuladores)

| Prioridad | Qué | Para qué | Variables |
|---|---|---|---|
| 🔴 | Yappy Comercial (Banco General): cuenta y botón de pago | Cobrar anticipos con Yappy | `YAPPY_MERCHANT_ID`, `YAPPY_SECRET` |
| 🔴 | PagueloFacil (o un banco adquirente): cotización, contrato y credenciales | Cobrar con tarjeta | `PAGUELOFACIL_CCLW`, `PAGUELOFACIL_TOKEN` |
| 🟠 | Anthropic: clave de la API (sin ella, el chat funciona en modo básico sin IA) | Asistente con IA 24/7 | `ANTHROPIC_API_KEY` |
| 🟠 | Resend: cuenta y dominio verificado | Correos de reservas, invitaciones y tickets | `RESEND_API_KEY`, `CORREO_REMITENTE` |
| 🟠 | Upstash Redis | Límite de peticiones compartido entre instancias | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| 🟢 | Sentry | Monitoreo de errores | `SENTRY_DSN` |
| 🟠 | Cloudflare R2 o Vercel Blob | Subir fotos de hoteles desde el panel | `BLOB_READ_WRITE_TOKEN` o credenciales de R2 |
| 🟢 | Wompi (Colombia): requiere una entidad en Colombia; credenciales de sandbox | Cobrar en COP con tarjeta, PSE y Nequi | `WOMPI_LLAVE_PUBLICA`, `WOMPI_LLAVE_PRIVADA`, `WOMPI_SECRETO_INTEGRIDAD`, `WOMPI_SECRETO_EVENTOS`, `WOMPI_URL_API` |
| 🟢 | PayPal (opcional) | Método extra para viajeros de EE. UU. y Europa | `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET` |

## Infraestructura y accesos

| Prioridad | Qué |
|---|---|
| 🔴 | Confirmar que el proyecto de Neon está en **Postgres 18** (el esquema usa `uuidv7()`) |
| 🔴 | Crear `CRON_SECRET` en Vercel y programar `/api/cron` cada minuto (Vercel Cron) |
| 🔴 | Crear `SECRETO_CIFRADO` en Vercel: 32 bytes aleatorios en base64 (comando en `.env.example`) |
| 🟠 | Proteger las ramas `main` y `develop` en GitHub (requiere un administrador) |
| 🟠 | Revisar en la vista previa de Vercel que la CSP no bloquee el mapa, las imágenes ni el panel |
| 🔴 | Cambiar el Root Directory del proyecto de Vercel a `apps/web` en el momento del lanzamiento (ver [DESPLIEGUE.md](DESPLIEGUE.md)) |
| 🟠 | Plan de Vercel: el cron cada minuto requiere Pro; si no, configurar un cron externo hacia `/api/cron` |
| 🟠 | Revisar y aprobar el PR #1 (`release/v1.3.0` → `main`), que incluye las fases 0 a 6 |

## Datos y negocio

| Prioridad | Qué | Situación |
|---|---|---|
| 🔴 | Impuestos de hospedaje en Panamá y Colombia (tasas y base de cálculo) | La tabla `tarifas.impuestos` existe vacía; la tasa debe validarla un contador |
| 🟠 | Márgenes de los 8 hoteles de Cartagena | Se importaron con un 30 % supuesto (ADR-013); WOPA debe ajustarlos con cada hotel |
| 🟠 | Dirección y ubicación exacta de cada hotel importado | Hoy tienen la ubicación del centro de Cartagena y “dirección por completar” |
| 🟠 | Cupos de los hoteles importados | Quedaron en modo solicitud; para cobrar el anticipo en línea hay que cargar cupos y pasarlos a `anticipo_en_linea` |
| 🟠 | Traducciones al inglés de los hoteles y tours importados | Solo existe el texto en español; la web muestra el español con un aviso |
| 🟠 | Revisar los textos de los 5 artículos de ayuda (es/en) | Redactados como borrador; WOPA debe validarlos |
| 🟠 | Probar el asistente con IA con conversaciones reales antes de abrirlo al público | Con la clave puesta: revisar respuestas, tono y uso de herramientas en `/admin/conversaciones`; ajustar instrucciones si hace falta |
| 🟠 | Hoteles de Panamá para el lanzamiento | Ciudades cargadas (Ciudad de Panamá, Boquete, Bocas del Toro); faltan hoteles |
| 🟠 | Política de moderación de reseñas | Criterio aplicado: publicar las auténticas aunque sean negativas; rechazar insultos, datos personales o contenido ajeno al hotel. WOPA debe confirmarlo y publicarlo en los términos |
| 🟢 | Panel y extranet solo en español | El equipo de WOPA y los hoteles de Panamá operan en español; la web pública sí es es/en |
| 🟢 | Reservas de varias habitaciones a la vez | Hoy una reserva es de una habitación con capacidad para todos los huéspedes |
| 🟢 | Frecuencia de liquidación, anticipo y horario de tickets | Valores por defecto aplicados: cada quincena, 25 % y de 8:00 a 20:00 |

## Seguridad y legal

| Prioridad | Qué |
|---|---|
| 🔴 | Auditoría de seguridad de la autenticación propia (ADR-012) antes del lanzamiento |
| ✅ 2026-10-15 | Impedir reutilizar un código TOTP dentro de su ventana de 30 s (migración 0017, `totp_ultimo_paso`) |
| 🟠 | Textos legales (términos, privacidad, cancelación) actualizados al cobro del anticipo, al margen y a la Ley 81 de 2019 de Panamá |
| 🔴 | Verificar en UAT el adaptador de Yappy: URL base (`YAPPY_URL_API`), forma de las respuestas, unidad de `paymentDate` y algoritmo del Hash del IPN (hoy: HMAC-SHA256 de orderId+status+domain). Después, `YAPPY_VERIFICADO=1` |
| 🟢 | Verificar en el sandbox de Wompi: creación del enlace de pago, consulta de transacciones, reembolsos y checksum de eventos. Después, `WOMPI_VERIFICADO=1` (solo cuando se venda en COP) |
| 🔴 | Verificar en el sandbox de PagueloFacil: URL base, respuesta de `LinkDeamon`, consulta de transacciones (conciliación) y reembolsos. Después, `PAGUELOFACIL_VERIFICADO=1` |
