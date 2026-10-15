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
| Fase 2 · Web pública es/en, ayuda y soporte | 0 h 15 min |
| Fase 3 · Cobro del anticipo, pagos y lanzamiento | 0 h 20 min |
| Fase 4 · Asistente con IA 24/7 | 0 h 05 min |
| Fase 5 · Extranet de hoteles y supervisión | 0 h 10 min |
| **Total** | **2 h 30 min** |

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
| 2026-10-14 | 22:58 | 23:09 | 0:10 | Fase 2 | Web pública es/en (portada, buscador accesible, resultados, destinos, ficha, reserva, Mi reserva, cancelación, tours), centro de ayuda y tickets, panel de reservas/soporte/correos, cron, SEO; pruebas de extremo a extremo | David + Claude |
| 2026-10-14 | 23:09 | 23:15 | 0:05 | Fase 3 | Investigación de la API de Yappy; contrato de pasarelas; adaptadores simulado, Yappy y PagueloFacil; servicio de pagos y pruebas | David + Claude |
| 2026-10-15 | 07:03 | 07:18 | 0:15 | Fase 3 | Pagos en la web (métodos por país, pasarela simulada, webhooks), panel de pagos y liquidaciones, cotización con PDF, textos sin “impuestos incluidos”, guía de despliegue; pruebas de extremo a extremo de pagos | David + Claude |
| 2026-10-15 | 07:18 | 07:24 | 0:05 | Fase 4 | Asistente con Claude (herramientas, historial que solo crece al final, respaldo ante rechazos, límites), modo sin IA, widget accesible, API de chat, panel de conversaciones; pruebas | David + Claude |
| 2026-10-15 | 07:24 | 07:28 | 0:10 | Fase 5 | Extranet de hoteles (calendario, tarifas, cupos, reservas, liquidaciones, soporte), revisión de contenido, semáforo de salud, alertas diarias; pruebas de extremo a extremo | David + Claude |
