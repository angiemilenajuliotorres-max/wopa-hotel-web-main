# Registro de horas

Horas trabajadas en el proyecto, por sesión. Hora local de Panamá (UTC−5).

- **Cómo se mide:** inicio y fin según las marcas de tiempo reales de la sesión (archivos de trabajo, versiones del documento de arquitectura y commits). Las duraciones se redondean a 5 minutos.
- **Qué incluye:** solo el tiempo de las sesiones de trabajo con el asistente. Agrega filas para el trabajo hecho fuera de ellas (reuniones con hoteles, cotizaciones con pasarelas, revisión, etc.).
- **Cómo registrar:** una fila por bloque de trabajo, en el mismo PR del trabajo cuando sea posible.

## Resumen

| Fase | Horas |
|---|---|
| Análisis y arquitectura | 0 h 50 min |
| Fase 0 · Estabilización (incluye Git Flow y documentación) | 0 h 10 min |
| Fase 1 · Base: esquema, identidad y precio | 0 h 40 min |
| Fase 2 · Web pública (servicios de búsqueda y reservas) | 0 h 05 min |
| **Total** | **1 h 45 min** |

## Detalle

| Fecha | Inicio | Fin | Duración | Fase | Actividad | Quién |
|---|---|---|---|---|---|---|
| 2026-10-14 | 21:07 | 21:13 | 0:05 | Arquitectura | Análisis del repositorio y primera versión del documento de arquitectura (UX, frontend, software, solución) | David + Claude |
| 2026-10-14 | 21:13 | 21:38 | 0:25 | Arquitectura | v0.2: cuentas de hotel creadas por WOPA, cobro en línea, es/en, pasarelas por país, base de datos con normas, chat y soporte | David + Claude |
| 2026-10-14 | 21:38 | 21:49 | 0:10 | Arquitectura | v0.3: anticipo, margen sobre tarifa neta, chat solo con IA 24/7, investigación de comisiones de pasarelas | David + Claude |
| 2026-10-14 | 21:49 | 21:56 | 0:10 | Arquitectura | v0.4: margen configurado por WOPA al aceptar cada hotel | David + Claude |
| 2026-10-14 | 21:56 | 22:07 | 0:10 | Fase 0 | Lanzamiento en Panamá, Git Flow, documentación en `docs/`, estabilización de la API, CI y registro de horas | David + Claude |
| 2026-10-14 | 22:08 | 22:25 | 0:15 | Fase 1 | Push de `develop` y `release/v0.1.0`; monorepo; cálculo de precio; migraciones 0001–0007; paso a PostgreSQL 18 único (Docker), sin SQLite | David + Claude |
| 2026-10-14 | 22:30 | 22:40 | 0:10 | Fase 1 | Preguntas de decisión; migraciones 0008–0012 (credenciales, pagos con partida doble, soporte, notificaciones, experiencias, auditoría); seguridad de identidad; importador de datos heredados; lista por revisar | David + Claude |
| 2026-10-14 | 22:39 | 22:49 | 0:10 | Fase 1–2 | `@wopa/servicios`: identidad (login, 2FA, invitaciones), catálogo (alta, aceptación con margen, ajustes, tarifas, cupos), búsqueda con precio total, reservas (retención, expiración, solicitudes, cancelación); transacciones anidadas | David + Claude |
| 2026-10-14 | 22:49 | 22:58 | 0:10 | Fase 1 | `apps/web` con Next.js 16: acceso con 2FA y QR, panel de WOPA (hoteles, márgenes, tarifas, cupos, invitaciones), extranet inicial; build de producción y prueba de extremo a extremo | David + Claude |
