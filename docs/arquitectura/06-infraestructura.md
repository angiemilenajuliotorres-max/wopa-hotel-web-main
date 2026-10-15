# 06 · Infraestructura

## Servicios

| Necesidad | Servicio | Estado |
|---|---|---|
| Hosting y funciones | Vercel | En uso |
| Base de datos | PostgreSQL 18: Docker en local y en CI, Neon en vista previa y producción | En uso |
| Autenticación | Better Auth: organizaciones, invitaciones, verificación en dos pasos | Fase 1 |
| Límite de peticiones y caché | Upstash Redis | Pendiente (hoy el límite vive en memoria) |
| Fotos | Cloudflare R2 o Vercel Blob | Fase 2 |
| Correo | Resend | Fase 2 |
| Pagos | Yappy, PagueloFacil (PayPal opcional) | Fase 3 |
| Asistente | API de Claude | Fase 4 |
| Colas y cron | Vercel Cron + Inngest | Fase 2–3 |
| Errores y monitoreo | Sentry | Fase 1 |

## Entornos

| Entorno | Rama Git | Vercel | Neon | Pasarelas |
|---|---|---|---|---|
| Local | cualquiera | `npm start` | Postgres 18 en Docker (`localhost:5433`) | Pruebas |
| Vista previa | `develop`, PRs | Preview | rama `develop` o una por PR | Pruebas |
| Producción | `main` | Production | rama `main` | Reales |

## Seguridad

- **Cabeceras**:
  - CSP, HSTS y `X-Content-Type-Options` en la API (helmet).
  - Las mismas cabeceras en los archivos estáticos, desde `vercel.json`, porque Vercel sirve `public/` sin pasar por Express.
- **CORS**: solo los orígenes listados en `FRONTEND_URL`. Sin esa variable, solo el mismo origen.
- **Límite de peticiones**: solo en `/api`, con un límite más estricto en el login del panel.
- **Secretos**: solo en Vercel, separados por entorno. Nunca en el repositorio.
- **Archivos de datos**: ningún archivo de base de datos se versiona en git.

## CI

GitHub Actions (`.github/workflows/ci.yml`), con Node 22 y 24 y un servicio `postgres:18`, en cada push y en cada PR a `develop` y `main`. Ejecuta `npm ci`, `npm run typecheck` y `npm test`.
