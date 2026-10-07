# WOPA Travel
Agencia de viajes de Panamá especializada en experiencias a Cartagena de Indias, con hoteles aliados y opciones de alojamiento personalizadas para viajeros.

## Ejecutar localmente

1. Instala Node.js 18 o superior.
2. Ejecuta `npm install` en la carpeta del proyecto.
3. Ejecuta `npm start` y abre `http://localhost:3000`.

La base SQLite y el catálogo inicial se crean automáticamente al iniciar el servidor. Se puede cambiar su ubicación con `DB_PATH`. Si `DATABASE_URL` está definida, el servidor usa PostgreSQL; para conservar SQLite local, deja esa variable sin configurar y usa `DB_PATH`.

## Panel de administración

1. Copia `.env.example` como `.env` y configura `ADMIN_USER`, `ADMIN_PASSWORD` y `ADMIN_SESSION_SECRET` con valores privados; no subas `.env` al repositorio.
2. Usa una contraseña administrativa larga. Genera un secreto de sesión aleatorio localmente con `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`; debe tener al menos 32 caracteres.
3. Reinicia el servidor y abre `http://localhost:3000/admin.html`.

El panel permite revisar reservas, cotizaciones y mensajes; registrar pagos y gastos; actualizar las tarifas publicadas y gestionar tours. Para cada tour se puede configurar un precio por persona o un precio fijo por grupo. La cancelación registra como penalización el 100% de los pagos recibidos en esa reserva. No se crea un movimiento adicional por la penalización, para no duplicar ingresos.

## Desplegar en Vercel con Neon

1. Crea una base PostgreSQL en Neon y copia su connection string pooled (`DATABASE_URL`). No es necesario copiar ni subir el archivo SQLite local.
2. Importa el repositorio en Vercel con la carpeta raíz del proyecto. `vercel.json` publica `public/` como contenido estático y `api/[...path].js` enruta las rutas `/api/*` al servidor Express.
3. En Vercel, abre **Project Settings > Environment Variables** y agrega `DATABASE_URL`, `ADMIN_USER`, `ADMIN_PASSWORD` y `ADMIN_SESSION_SECRET` para Production (y Preview si corresponde). Configúralas manualmente en el Dashboard; no las agregues al repositorio ni a `vercel.json`.
4. Usa un usuario administrativo propio, una contraseña larga y un secreto aleatorio de al menos 32 caracteres. Después despliega y verifica `/api/health`.

En el primer arranque cloud se crean idempotentemente las tablas, las columnas actuales y el catálogo base de hoteles, tarifas y experiencias. La inicialización no importa registros de `server/db/hotel.db`: cualquier migración de datos locales a Neon debe planificarse, respaldarse y ejecutarse por separado.

Las pruebas locales usan una base SQLite temporal y no modifican `server/db/hotel.db`. Ejecuta `npm test`.

El informe descargable es un archivo `.xlsx` para la semana ISO seleccionada en el panel. Incluye resumen, bitácora de actividad, reservas recibidas, cancelaciones, cotizaciones, mensajes y movimientos financieros. La bitácora registra nuevas solicitudes, cambios de estado, cancelaciones, pagos y mantenimiento del catálogo; su historial comienza al activar esta versión, mientras que los registros anteriores conservan solo los estados y fechas que ya estaban guardados. El informe no mide visitas o navegación anónima. La utilidad neta se calcula a partir de ingresos y gastos registrados, por lo que no reemplaza la contabilidad fiscal.

## Solicitudes desde la web

- Las solicitudes de hospedaje, cotizaciones y mensajes de contacto se guardan en SQLite y reciben un código de seguimiento.
- Tras enviar una cotización, el sistema calcula el hospedaje y los tours con tarifa publicada, suma un total automático y permite descargarlo en PDF. Si un producto no tiene precio configurado, genera un estimado parcial y lo excluye del total; no requiere que el administrador prepare manualmente cada cotización.
- Una solicitud de hospedaje no confirma disponibilidad ni genera un cobro. WOPA Travel debe confirmar el aliado y el precio antes de aceptar la reserva.
- Los tours se presentan como ideas de itinerario y se cotizan bajo solicitud; la disponibilidad, el operador, las inclusiones y el precio final deben confirmarse.
- El anticipo mostrado para hospedaje es una estimación del 25% del subtotal, sujeta a confirmación.
