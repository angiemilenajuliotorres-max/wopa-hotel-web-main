# Despliegue y cambio a la web nueva

La web nueva (`apps/web`, Next.js) reemplaza a la actual (`server/` + `public/`) **en el mismo proyecto de Vercel**, como se decidió. Mientras no se haga el cambio, producción sigue sirviendo la web actual desde la raíz del repositorio.

## Antes del cambio (bloqueantes)

Todo lo marcado con 🔴 en [POR-REVISAR.md](POR-REVISAR.md), en especial:

1. El proyecto de Neon está en **Postgres 18**.
2. Hay al menos un medio de pago real **verificado en sandbox**: `YAPPY_VERIFICADO=1` o `PAGUELOFACIL_VERIFICADO=1`, con sus credenciales. Sin pasarela real, la web muestra “el pago en línea se habilita con el lanzamiento” y solo funcionan las solicitudes.
3. Las tasas de impuestos están validadas por un contador.
4. Se completó la auditoría de seguridad de la autenticación.

## Pasos del cambio

1. **Base de datos (Neon, rama `main`):**
   ```bash
   DATABASE_URL="<cadena de Neon>" npm run db:migrar
   DATABASE_URL="<cadena de Neon>" ADMIN_CORREO=… ADMIN_NOMBRE=… ADMIN_CLAVE=… npm run admin:crear
   DATABASE_URL="<cadena de Neon>" ADMIN_CORREO=… npm run db:importar-legado
   ```
   El esquema nuevo vive en sus propios esquemas (`catalogo`, `reservas`, …) y no toca las tablas de la web actual en `public`.
2. **Variables en Vercel** (Production y Preview), según `.env.example`:
   - `DATABASE_URL`, `SECRETO_CIFRADO` (32 bytes en base64), `URL_PUBLICA`, `CRON_SECRET`, `CORREO_SOPORTE`.
   - Correo: `RESEND_API_KEY` y `CORREO_REMITENTE`.
   - Pasarelas: `YAPPY_*` y/o `PAGUELOFACIL_*`, con su marca `*_VERIFICADO=1`.
   - **No** definir `PAGOS_SIMULADOS` en producción.
3. **Proyecto de Vercel** → Settings → General → **Root Directory = `apps/web`** (Framework: Next.js). `apps/web/vercel.json` instala desde la raíz del monorepo y programa `/api/cron` cada minuto.
   - El cron cada minuto requiere el plan Pro de Vercel. En el plan Hobby solo hay crons diarios, así que habría que usar un cron externo que llame a `/api/cron` con `Authorization: Bearer <CRON_SECRET>`.
4. **Desplegar** `main` y revisar:
   - `/es` y `/en`;
   - una búsqueda;
   - una reserva de prueba con un monto mínimo en la pasarela real;
   - `/acceso` con 2FA;
   - `/admin/pagos`;
   - `/sitemap.xml`.
5. **Activar los proveedores** en la base: `UPDATE pagos.proveedores SET esta_activo = true WHERE codigo IN ('yappy', 'paguelofacil');` (solo los verificados).
6. **Redirecciones del sitio anterior:** las URL viejas (`/`, `/admin.html`, `/legal/*.html`) siguen funcionando: `/` redirige al idioma y `/legal/*.html` existe en `apps/web/public/legal/`. El panel viejo `admin.html` deja de existir; el nuevo está en `/admin`.

## Después del cambio

- En un PR aparte (`feature/f3-retirar-legado`), eliminar `server/`, `public/`, `api/`, `test/integration.test.js`, `vercel.json` de la raíz y las dependencias de Express, una vez confirmado que producción funciona con la web nueva.
- Las tablas heredadas en `public` se pueden respaldar y eliminar con una migración nueva tras un periodo de convivencia (por ejemplo, 30 días).

## Volver atrás

Cambiar Root Directory de vuelta a la raíz y volver a desplegar el último commit de `main` anterior al cambio. Las tablas heredadas siguen intactas.
