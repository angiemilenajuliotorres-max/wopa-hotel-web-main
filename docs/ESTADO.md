# Estado del proyecto

Tablero de lo que **ya se tiene** y lo que **falta**, por fase. Se actualiza en el mismo PR que completa cada ítem.

Lo que necesita una persona (cuentas, datos, validaciones) está en [POR-REVISAR.md](POR-REVISAR.md).

Leyenda: ✅ hecho · 🟡 en curso o parcial · ⬜ falta · ⛔ bloqueado (necesita una decisión o un acceso externo)

**Fase actual:** 4 · Asistente con IA (fase 3 lista en `release/v1.0.0`; el lanzamiento espera los 🔴 de [POR-REVISAR.md](POR-REVISAR.md))
**Lanzamiento:** Panamá, al cerrar la fase 3 (`v1.0.0`)

---

## Lo que ya se tiene (código heredado en `server/` y `public/`)

| Funcionalidad | Estado | Qué pasa con ella |
|---|---|---|
| Web pública en una página, es/en en el navegador | ✅ en producción | Se reemplaza en la fase 2 |
| Catálogo de 8 hoteles aliados en Cartagena (guardados como `tipos_habitacion`) | ✅ | Se migra al esquema nuevo en la fase 1 |
| Tarifas por 2 y 4 personas, solo temporada baja | ✅ | Pasan a tarifa neta por día + margen |
| Solicitud de reserva con código de seguimiento (sin cobro) | ✅ | Se migra; la fase 3 la reemplaza por el cobro del anticipo |
| Cotización automática con PDF | ✅ | Se conserva en el módulo `experiencias` |
| Tours y experiencias (6) | ✅ | Se conservan, vinculados a una ciudad |
| Formulario de contacto | ✅ | Pasa a tickets de soporte |
| Panel admin: reservas, cotizaciones, mensajes, pagos y gastos manuales, tarifas, tours | ✅ | Se conserva hasta que el panel nuevo lo reemplace |
| Informe semanal en Excel y bitácora de actividad | ✅ | Se adapta a `auditoria` y `pagos.asientos` |
| Login de admin único con cookie HMAC y límite de intentos | ✅ | Lo reemplaza `identidad` con roles en la fase 1 |
| Despliegue Vercel + Neon | ✅ | Se conserva |
| Base de datos: SQLite en local y Neon en producción | ✅ Cambiado | Desde la fase 1, solo PostgreSQL 18: Docker en local y Neon en producción ([ADR-010](decisiones.md)) |
| Control de disponibilidad | ❌ roto | Desactivado en la fase 0; se rehace con `cupos_dia` |

---

## Fase 0 · Estabilización → `v0.1.0`

| Ítem | Estado |
|---|---|
| Git Flow: rama `develop`, convenciones y plantilla de PR | ✅ |
| Documentación de arquitectura y decisiones en `docs/` | ✅ |
| Quitar rutas de prueba (`/api/admin-test`, `/api/admin/test-directo`) y logs de depuración | ✅ |
| Rutas `/api` desconocidas responden 404 en JSON (antes devolvían el HTML de la web) | ✅ |
| CORS restringido a `FRONTEND_URL` (sin esa variable, solo el mismo origen) | ✅ |
| CSP activa en la API (helmet) y en los archivos estáticos (`vercel.json`) | ✅ Falta revisar en la vista previa de Vercel que el mapa, las imágenes y el panel se vean bien |
| Límite de peticiones solo en `/api` (antes afectaba también a los archivos estáticos) | ✅ |
| Desactivar `POST /api/habitaciones/disponibilidad` (responde 410; ninguna pantalla lo usa) | ✅ |
| Sacar `server/db/hotel.db` y `node_modules/` del repositorio (estaban versionados pese a `.gitignore`) | ✅ |
| CI en GitHub Actions (`npm ci` + `npm test`, Node 20 y 22) | ✅ Se verá en verde después del primer push |
| Pruebas de los cambios de seguridad | ✅ 4 pruebas en verde |
| Lint (ESLint) | ⬜ Se agrega con el monorepo en la fase 1 |
| Registro de horas en `docs/HORAS.md` | ✅ |
| Límite de peticiones compartido entre instancias (Upstash Redis) | ⛔ Requiere crear una cuenta de Upstash y configurar `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` en Vercel |
| Protección de ramas en GitHub | ⛔ Requiere permisos de administrador del repositorio |

> **Importante al bajar la fase 0:** `node_modules/` y `server/db/hotel.db` dejaron de versionarse. Al hacer `git pull`, git los borra de tu copia local. Después del pull:
> 1. Ejecuta `npm ci`.
> 2. Desde la fase 1 ya no se usa SQLite: levanta Postgres con `docker compose up -d`. Si quieres, borra `server/db/hotel.db`.

## Fase 1 · Base: esquema, identidad y precio → `v0.2.0`

| Ítem | Estado |
|---|---|
| Un solo proveedor de base de datos: PostgreSQL 18 (Docker local, Neon), driver `pg`; fuera SQLite y PGlite ([ADR-010](decisiones.md)) | ✅ |
| `docker-compose.yml` con Postgres 18 (puerto 5433) | ✅ |
| Monorepo con npm workspaces y TypeScript sin compilar (Node 22.18+): `packages/db`, `packages/dominio` | ✅ |
| `typecheck` y CI con servicio `postgres:18` (Node 22 y 24) | ✅ |
| Migrador propio: transacción por migración, bloqueo, huella anti-edición, `npm run db:migrar` ([ADR-011](decisiones.md)) | ✅ |
| Esquemas `geo`, `identidad`, `catalogo`, `tarifas`, `reservas` (migraciones 0001–0006) | ✅ |
| Datos de referencia: PA y CO, USD y COP, es y en, Ciudad de Panamá, Boquete, Bocas del Toro, Cartagena, 16 servicios (0007) | ✅ |
| Reglas en la base: margen obligatorio para publicar, sin solape de márgenes, sin sobreventa, coherencia entre hoteles, historial de estados | ✅ 20 pruebas |
| Cálculo de precio: neta + margen por hotel + redondeo + anticipo + liquidación (`@wopa/dominio/tarifas`) | ✅ 16 pruebas |
| Esquemas `pagos` (libro de partida doble que debe cuadrar), `soporte`, `notificaciones`, `experiencias`, `auditoria` (0009–0011) | ✅ |
| Credenciales, sesiones e intentos de acceso; corrección de 3FN en `usuarios` (0008) | ✅ |
| Seguridad de identidad: scrypt, tokens, TOTP (RFC 6238) y AES-256-GCM ([ADR-012](decisiones.md)) | ✅ 14 pruebas |
| `npm run admin:crear`: primer administrador de WOPA | ✅ |
| Importador de la web heredada (`npm run db:importar-legado`), idempotente, con margen del 30 % ([ADR-013](decisiones.md)) | ✅ 5 pruebas |
| `apps/web`: Next.js 16 + React 19 + TypeScript, CSP y cabeceras de seguridad, `proxy` de idioma | ✅ Compila en producción |
| `@wopa/servicios/identidad`: inicio de sesión, 2FA obligatoria, sesiones, invitaciones, permisos y bloqueo por fuerza bruta | ✅ 8 pruebas |
| Pantallas de acceso: login, configuración de 2FA con QR, verificación, activación de invitación, cierre de sesión | ✅ Probadas de extremo a extremo (`npm run e2e:acceso`) |
| `@wopa/servicios/catalogo`: crear hotel, aceptar con margen, ajustar margen con historial, habitaciones, tarifa neta y cupos por rango, alerta de precio anómalo | ✅ |
| Panel de WOPA: hoteles, alertas, alta de hotel, aceptación con margen, ajustes con historial, habitaciones, tarifa neta, cupos, invitaciones | ✅ |
| Sistema de diseño: tokens de marca (azul y dorado), componentes base, accesibilidad (foco visible, zonas táctiles de 44 px) | ✅ |
| Sentry | ⛔ Requiere cuenta (ver [POR-REVISAR.md](POR-REVISAR.md)) |
| Confirmar que el proyecto de Neon está en Postgres 18 | ⛔ Ver [POR-REVISAR.md](POR-REVISAR.md) |

## Fase 2 · Web pública es/en y centro de ayuda → `v0.3.0`

| Ítem | Estado |
|---|---|
| `@wopa/servicios/busqueda`: autocompletado tolerante a tildes, resultados con precio total, anticipo y saldo, ficha con opciones | ✅ |
| Portada, destinos, búsqueda con autocompletado accesible, ficha de hotel, tours, en es/en | ✅ Prueba de extremo a extremo (`npm run e2e:publico`) |
| SEO: metadatos por página, hreflang, canonical, sitemap con alternativas, robots, datos estructurados de hotel | ✅ |
| Formulario de reserva con “pagas hoy / pagas en el hotel”, estado de la reserva, Mi reserva sin cuenta, cancelación | ✅ |
| `@wopa/servicios/reservas`: precio congelado, retención de 15 min sin sobreventa, expiración, solicitudes aceptadas o rechazadas, consulta y cancelación con política | ✅ 9 pruebas |
| Centro de ayuda (5 artículos es/en) y tickets: formulario, plazos por categoría, panel con respuestas y notas internas | ✅ 5 pruebas |
| Panel: reservas (aceptar o rechazar solicitudes), soporte, bandeja de correos simulados | ✅ |
| Endpoint de cron (`/api/cron`): expira retenciones y envía correos | ✅ (falta programarlo en Vercel al lanzar) |
| Correos transaccionales: bandeja de salida con envío por Resend o simulado | ✅ (plantillas en texto; falta HTML) |
| Fotos en almacenamiento propio | ⛔ Requiere cuenta de R2 o Vercel Blob; hoy se usan enlaces https |
| Correos en HTML con diseño de marca | ⬜ Hoy se envían en texto plano |

## Fase 3 · Cobro del anticipo y lanzamiento en Panamá → `v1.0.0`

| Ítem | Estado |
|---|---|
| Interfaz `ProveedorPago`, enrutador por país con respaldo automático, webhooks idempotentes, comparación del monto, transiciones válidas ([ADR-014](decisiones.md)) | ✅ 11 pruebas |
| Pasarela simulada con firma HMAC (desarrollo y pruebas) | ✅ Prueba de extremo a extremo (`npm run e2e:pagos`) |
| Adaptador Yappy | 🟡 Implementado según la documentación pública; ⛔ falta verificarlo en UAT (credenciales, URL base y algoritmo del hash) |
| Adaptador de tarjetas (PagueloFacil) | 🟡 Creación del enlace implementada; ⛔ falta verificar la API, la consulta de transacciones y los reembolsos en el sandbox |
| Cobro del anticipo, saldo en el hotel, cancelación con reembolso según política, asientos de partida doble, conciliación de pendientes, liquidaciones (generar, aprobar, pagar), reembolsos manuales | ✅ |
| Panel de pagos: cobros, saldos contables, liquidaciones y reembolsos pendientes | ✅ |
| Validación fiscal de impuestos de hospedaje en Panamá | ⛔ Requiere un contador |
| Cotización automática de hospedaje y tours con PDF (paridad con la web actual) | ✅ 3 pruebas |
| La web nueva reemplaza a `public/index.html` | 🟡 Lista; los pasos están en [DESPLIEGUE.md](DESPLIEGUE.md); ⛔ requiere cambiar el Root Directory en Vercel y cerrar los 🔴 |
| Retirar el código heredado (`server/`, `public/`, `api/`) | ⬜ Después del cambio en producción |

## Fase 4 · Asistente con IA 24/7 → `v1.1.0`

| Ítem | Estado |
|---|---|
| Widget, API de chat con streaming y herramientas | ⬜ |
| Creación de tickets con resumen | ⬜ |
| Panel de conversaciones y valoraciones | ⬜ |

## Fase 5 · Extranet de hoteles y supervisión → `v1.2.0`

| Ítem | Estado |
|---|---|
| Ficha, habitaciones y calendario de tarifa neta y cupos | ⬜ |
| Cola de revisión, semáforo de salud y alertas | ⬜ |

## Fase 6 · Expansión

| Ítem | Estado |
|---|---|
| Adaptador para Colombia (Wompi o PayU) | ⬜ |
| Reseñas, paquetes hotel + tour, más idiomas | ⬜ |

---

## Decisiones pendientes

| Pregunta | Recomendación | Bloquea |
|---|---|---|
| ¿Se sigue vendiendo el catálogo de Cartagena en el lanzamiento? | Sí, vendido desde Panamá en USD | Datos iniciales (fase 1) |
| ¿PagueloFacil o un banco para tarjetas? | Pedir cotización a ambos | Fase 3 |
| ¿Porcentaje de anticipo por defecto? | 25 %, nunca menos que el margen | Fase 1 (cálculo) |
| ¿Cada cuánto se liquida a los hoteles? | Cada quincena | Fase 3 |
| ¿Horario del equipo para tickets? | 8:00–20:00 (hora de Panamá), con guardia para urgentes | Fase 2 |
