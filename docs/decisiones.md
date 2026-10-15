# Registro de decisiones (ADR)

Cada decisión tiene un estado: **Aceptada**, **Propuesta** (falta confirmar) o **Reemplazada por ADR-NNN**. Una decisión aceptada no se edita: si cambia, se agrega una nueva que la reemplaza.

---

## ADR-001 · Lanzamiento en Panamá
**Estado:** Aceptada · 2026-10-14

**Contexto.** WOPA Travel es una empresa panameña. El catálogo actual vende hoteles aliados en Cartagena a viajeros, sobre todo panameños.

**Decisión.** La plataforma se lanza operando desde **Panamá**:
- País de la empresa y de cobro: Panamá (`PA`). Moneda de cobro: **USD**. Zona horaria operativa: `America/Panama`.
- Pasarelas de lanzamiento: **Yappy** y **PagueloFacil** (ver ADR-006).
- Destinos de lanzamiento: hoteles en **Panamá** y el catálogo actual de **Cartagena**, vendido desde Panamá en USD.
- Idiomas: español e inglés (ADR-005).
- Normativa: Ley 81 de 2019 de protección de datos personales de Panamá. Los registros turísticos de los hoteles se guardan en `registro_turismo` según el país.

**Consecuencias.** Colombia (pesos, PSE, Nequi) queda para la fase 6 con su propio adaptador de pagos. Los impuestos de hospedaje de Panamá deben validarse con un contador antes de la fase 3.

**Pendiente de confirmar:** que el catálogo de Cartagena se siga vendiendo en el lanzamiento.

## ADR-002 · Monolito modular en TypeScript con Next.js
**Estado:** Aceptada

Un solo despliegue en Vercel, organizado en módulos con fronteras estrictas (`identidad`, `geo`, `catalogo`, `tarifas`, `reservas`, `pagos`, `soporte`, `experiencias`, `auditoria`). Cada módulo es dueño de un esquema de Postgres. Next.js (App Router) para la web pública, la extranet y el panel. El código Express actual (`server/`, `public/`) sigue en producción hasta que la fase 2 lo reemplace (patrón *strangler*).

## ADR-003 · PostgreSQL como único motor, con migraciones versionadas
**Estado:** Reemplazada en parte por ADR-010 (pruebas y driver) y ADR-011 (herramienta de migraciones)

Se elimina el adaptador doble SQLite/Postgres. Neon en producción y vista previa; PGlite en las pruebas. Drizzle ORM con migraciones SQL versionadas. No hay cambios de esquema al arrancar la aplicación.

## ADR-004 · Cuentas de hotel creadas por WOPA
**Estado:** Aceptada

No hay autoregistro. WOPA crea la organización y el hotel, e invita a sus usuarios por correo. Los usuarios activan la cuenta con verificación en dos pasos obligatoria. Los cambios de contenido del hotel pasan por revisión de WOPA. Los precios y cupos se aplican al momento y se vigilan con alertas.

## ADR-005 · Idiomas de lanzamiento: español e inglés
**Estado:** Aceptada

Idioma en la URL (`/es`, `/en`). Contenido en tablas `*_traducciones`. Agregar un idioma no requiere cambiar código.

## ADR-006 · Pasarelas intercambiables con enrutamiento por país
**Estado:** Aceptada

Todas las pasarelas cumplen la misma interfaz `ProveedorPago`. La tabla `pagos.reglas_enrutamiento` elige el proveedor según el país del comprador, el país del hotel, la moneda y el método. Lanzamiento: Yappy (1 % + ITBMS) y PagueloFacil (tarifa por cotizar). PayPal (5,40 % + tarifa fija) queda como opción extra. Stripe se descarta porque no opera para empresas de Panamá.

**Pendiente:** cotización por escrito de PagueloFacil y de un banco adquirente.

## ADR-007 · WOPA vende y cobra solo el anticipo en línea
**Estado:** Aceptada

WOPA cobra en la web como vendedor (*merchant of record*). Se cobra el **anticipo**; el saldo lo cobra el hotel a la llegada. El anticipo es el mayor entre el porcentaje del plan (25 % por defecto) y el margen de WOPA de la estadía. La reserva se confirma solo cuando la pasarela notifica que el pago fue capturado.

## ADR-008 · Precio al público = tarifa neta + margen por hotel
**Estado:** Aceptada

El hotel carga su tarifa **neta**. WOPA configura el **margen de cada hotel al aceptarlo**, en porcentaje o monto fijo, por plan o por temporada si hace falta, y lo ajusta después. No existe un margen global. Un hotel no se publica sin margen vigente. Los ajustes no se editan sobre la regla anterior: se cierra la regla vigente y se crea otra, con su motivo. La reserva congela la neta, el margen y la venta de cada noche.

Ejemplo: neta 50.000 + margen 15.000 = 65.000 al público. Se cobra un anticipo de 16.250 (25 %, mayor que el margen), WOPA se queda 15.000 y liquida 1.250 al hotel, que cobra 48.750 en la llegada.

## ADR-009 · Chat atendido solo por IA, 24/7
**Estado:** Aceptada

El chat lo atiende un asistente con la API de Claude y herramientas de solo lectura, en español e inglés, a cualquier hora. Si no resuelve, crea un ticket con un resumen y el equipo responde por correo. No hay agentes humanos en vivo ni WhatsApp por ahora; el modelo de datos permite agregarlos después.

## ADR-010 · Un solo proveedor: PostgreSQL 18, con Docker en local
**Estado:** Aceptada · 2026-10-14

**Contexto.** La web heredada usaba SQLite en local y Neon en producción, con dos drivers (`better-sqlite3` y `@neondatabase/serverless`). Las pruebas usaban SQLite y PGlite. SQLite provocaba cierres abruptos intermitentes en las pruebas, y mantener dos motores obligaba a traducir el SQL.

**Decisión.** Un solo proveedor: **PostgreSQL 18**.
- **Local:** Postgres 18 en Docker (`docker compose up -d`, puerto 5433).
- **Producción y vista previa:** Neon. El proyecto de Neon debe estar en **Postgres 18**, porque el esquema usa `uuidv7()`.
- **Driver único:** `pg` (node-postgres), tanto para la API heredada como para el esquema nuevo.
- **Pruebas:** crean una base temporal en ese mismo Postgres y la eliminan al terminar. En CI, un servicio `postgres:18`.
- Se eliminan SQLite, PGlite, `@neondatabase/serverless` y `ws`.

**Consecuencias.** Hace falta Docker para desarrollar y probar. Las pruebas corren sobre el mismo motor que producción.

## ADR-011 · Migraciones SQL escritas a mano y ubicación sin PostGIS
**Estado:** Aceptada · 2026-10-14

- Las migraciones son archivos `packages/db/migraciones/NNNN_nombre.sql`. Las aplica un migrador propio (`npm run db:migrar`):
  - cada migración corre en su propia transacción;
  - un bloqueo impide dos ejecuciones a la vez;
  - se guarda una huella de cada archivo, y el migrador falla si una migración ya publicada fue editada.
- **Drizzle no se usa por ahora.** Se evaluará en la fase 2, solo como generador de consultas tipadas, sin que genere el esquema.
- **Ubicación:** latitud y longitud con validaciones, en lugar de PostGIS. Alcanza para mapas y autocompletado; si hace falta búsqueda por distancia, se agrega `earthdistance` o PostGIS en una migración nueva.
