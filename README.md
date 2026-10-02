# WOPA Travel
Agencia de viajes de Panamá especializada en experiencias a Cartagena de Indias, con hoteles aliados y opciones de alojamiento personalizadas para viajeros.

## Ejecutar localmente

1. Instala Node.js 18 o superior.
2. Ejecuta `npm install` en la carpeta del proyecto.
3. Ejecuta `npm start` y abre `http://localhost:3000`.

La base SQLite y el catálogo inicial se crean automáticamente al iniciar el servidor. Se puede cambiar su ubicación con la variable de entorno `DB_PATH`.

## Panel de administración

1. Copia `.env.example` como `.env` y configura `ADMIN_USER`, `ADMIN_PASSWORD` y `ADMIN_SESSION_SECRET` con valores privados; no subas `.env` al repositorio.
2. Genera valores aleatorios localmente con `node -e "const c=require('crypto'); console.log('ADMIN_PASSWORD='+c.randomBytes(18).toString('base64url')); console.log('ADMIN_SESSION_SECRET='+c.randomBytes(48).toString('base64url'))"` y pégalos en `.env`. La contraseña debe tener al menos 14 caracteres y el secreto de sesión al menos 32.
3. Reinicia el servidor y abre `http://localhost:3000/admin.html`.

El panel permite revisar reservas, cotizaciones y mensajes; registrar pagos y gastos; actualizar las tarifas publicadas y gestionar tours. Para cada tour se puede configurar un precio por persona o un precio fijo por grupo. La cancelación registra como penalización el 100% de los pagos recibidos en esa reserva. No se crea un movimiento adicional por la penalización, para no duplicar ingresos.

El informe descargable es un archivo `.xlsx` con resumen, reservas, cotizaciones, contactos y movimientos financieros. La utilidad neta se calcula a partir de ingresos y gastos registrados, por lo que no reemplaza la contabilidad fiscal.

## Solicitudes desde la web

- Las solicitudes de hospedaje, cotizaciones y mensajes de contacto se guardan en SQLite y reciben un código de seguimiento.
- Tras enviar una cotización, el sistema calcula el hospedaje y los tours con tarifa publicada, suma un total automático y permite descargarlo en PDF. Si un producto no tiene precio configurado, genera un estimado parcial y lo excluye del total; no requiere que el administrador prepare manualmente cada cotización.
- Una solicitud de hospedaje no confirma disponibilidad ni genera un cobro. WOPA Travel debe confirmar el aliado y el precio antes de aceptar la reserva.
- Los tours se presentan como ideas de itinerario y se cotizan bajo solicitud; la disponibilidad, el operador, las inclusiones y el precio final deben confirmarse.
- El anticipo mostrado para hospedaje es una estimación del 25% del subtotal, sujeta a confirmación.
