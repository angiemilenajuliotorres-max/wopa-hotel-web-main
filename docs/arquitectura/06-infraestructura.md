# 06 · Infraestructura

## Servicios

| Necesidad | Servicio | Estado |
|---|---|---|
| Hosting y funciones | Vercel | En uso |
| Base de datos | Neon Postgres, con una rama por entorno | En uso |
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
| Local | cualquiera | `npm start` | SQLite (legado) o PGlite / Postgres local | Pruebas |
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

GitHub Actions (`.github/workflows/ci.yml`): `npm ci` + `npm test` en cada push y en cada PR a `develop` y `main`.
