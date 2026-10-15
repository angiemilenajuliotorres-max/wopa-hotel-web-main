# Estado del proyecto

Tablero de lo que **ya se tiene** y lo que **falta**, por fase. Se actualiza en el mismo PR que completa cada ítem.

Leyenda: ✅ hecho · 🟡 en curso o parcial · ⬜ falta · ⛔ bloqueado (necesita una decisión o un acceso externo)

**Fase actual:** 0 · Estabilización
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
| Despliegue Vercel + Neon, pruebas de integración con PGlite | ✅ | Se conserva |
| Control de disponibilidad | ❌ roto | Desactivado en la fase 0; se rehace con `cupos_dia` |

---

## Fase 0 · Estabilización → `v0.1.0`

| Ítem | Estado |
|---|---|
| Git Flow: rama `develop`, convenciones y plantilla de PR | ✅ |
| Documentación de arquitectura y decisiones en `docs/` | ✅ |
| Quitar rutas de prueba (`/api/admin-test`, `/api/admin/test-directo`) y logs de depuración | ⬜ |
| CORS restringido a `FRONTEND_URL` (sin esa variable, solo el mismo origen) | ⬜ |
| CSP activa en la API (helmet) y en los archivos estáticos (`vercel.json`) | ⬜ |
| Límite de peticiones solo en `/api` (hoy afecta también a los archivos estáticos) | ⬜ |
| Desactivar `POST /api/habitaciones/disponibilidad` (consulta una columna que no existe) | ⬜ |
| Sacar `server/db/hotel.db` del repositorio | ⬜ |
| CI en GitHub Actions (`npm ci` + `npm test`) | ⬜ |
| Pruebas de los cambios de seguridad | ⬜ |
| Límite de peticiones compartido entre instancias (Upstash Redis) | ⛔ Requiere crear una cuenta de Upstash y configurar `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` en Vercel |
| Protección de ramas en GitHub | ⛔ Requiere permisos de administrador del repositorio |

## Fase 1 · Base: esquema, identidad y precio → `v0.2.0`

| Ítem | Estado |
|---|---|
| Monorepo con npm workspaces: `apps/web` (Next.js + TypeScript), `packages/db`, `packages/dominio` | ⬜ |
| Drizzle + migraciones SQL. Esquemas: `geo`, `identidad`, `catalogo`, `tarifas`, `reservas` | ⬜ |
| Datos iniciales de `geo`: Panamá y Colombia, USD y COP, es y en, ciudades de lanzamiento | ⬜ |
| Esquemas `pagos`, `soporte`, `experiencias`, `auditoria` | ⬜ |
| Script de migración de los datos actuales, con pruebas | ⬜ |
| Cálculo de precio: neta + margen por hotel + redondeo + anticipo, con pruebas unitarias | ⬜ |
| Identidad: usuarios, organizaciones, invitaciones, roles y verificación en dos pasos | ⬜ |
| Aceptación de hotel con margen obligatorio | ⬜ |
| Sistema de diseño (tokens y componentes base) | ⬜ |
| Sentry | ⬜ |

## Fase 2 · Web pública es/en y centro de ayuda → `v0.3.0`

| Ítem | Estado |
|---|---|
| Inicio, destinos, búsqueda, ficha de hotel, tours (es/en, SEO) | ⬜ |
| Retención de cupo y máquina de estados de la reserva | ⬜ |
| Centro de ayuda y tickets (formulario + panel) | ⬜ |
| Correos transaccionales (Resend) y fotos en almacenamiento propio | ⬜ |

## Fase 3 · Cobro del anticipo y lanzamiento en Panamá → `v1.0.0`

| Ítem | Estado |
|---|---|
| Interfaz `ProveedorPago`, enrutador y webhooks idempotentes | ⬜ |
| Adaptador Yappy | ⛔ Requiere cuenta Yappy Comercial en Banco General |
| Adaptador de tarjetas (PagueloFacil o banco) | ⛔ Requiere la cotización y elegir el proveedor |
| Anticipo, saldo en el hotel, devoluciones, asientos, conciliación y liquidaciones | ⬜ |
| Validación fiscal de impuestos de hospedaje en Panamá | ⛔ Requiere un contador |
| La web nueva reemplaza a `public/index.html` | ⬜ |

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
