# 03 · Base de datos

PostgreSQL ([ADR-003](../decisiones.md)). En producción, Neon. En pruebas, PGlite.

## Normas de diseño

1. **Tercera forma normal (3FN).** Cada dato vive en un solo lugar. Nada de listas separadas por comas, ni de ciudad o país como texto libre.
2. **Excepción documentada: datos congelados.** La reserva guarda la neta, el margen y la venta de cada noche, la política de cancelación y los datos del titular, tal como estaban al momento de la venta.
3. **Nomenclatura.**
   - `snake_case`, en español y sin tildes. Tablas en plural.
   - Clave primaria `id`, claves foráneas `<entidad>_id`.
   - Booleanos con prefijo `es_` o `tiene_`. Instantes con sufijo `_en`; fechas con prefijo `fecha_`.
4. **Claves.**
   - `uuid` v7 como clave primaria.
   - Los catálogos ISO usan su código natural como clave: `paises.codigo char(2)`, `monedas.codigo char(3)`, `idiomas.codigo`.
   - Los códigos públicos legibles (`WP-7KX2M9`) van en una columna `UNIQUE` aparte.
5. **Tipos.**
   - Dinero en `bigint` de centavos, más el código de moneda.
   - `timestamptz` en UTC para instantes y `date` para noches.
   - `citext` para correos.
   - `jsonb` solo para los mensajes crudos de las pasarelas y los datos congelados.
6. **Integridad en la base.**
   - `NOT NULL` por defecto.
   - `CHECK` para rangos y estados; `UNIQUE` para reglas de negocio.
   - `ON DELETE` explícito en cada clave foránea: `RESTRICT` en todo lo financiero.
   - `EXCLUDE` para impedir que se solapen las vigencias.
7. **Índices.**
   - Uno en cada clave foránea.
   - Compuestos, según las consultas reales.
   - Parciales, como `WHERE estado = 'retenida'`.
   - De trigramas para el autocompletado.
8. **Auditoría y borrado.**
   - `creado_en` y `actualizado_en` en todas las tablas.
   - Borrado lógico (`eliminado_en`) solo en el catálogo.
   - Lo financiero no se edita ni se borra: se corrige con un registro nuevo.
9. **Un esquema por módulo y mínimo privilegio.** La aplicación usa un rol sin permisos para cambiar el esquema; las migraciones usan otro.
10. **Datos personales.** Se identifican y tienen un plazo de retención. Nunca se guardan datos de tarjeta: solo la referencia del proveedor.
11. **Migraciones.** Versionadas, revisadas en un PR y probadas antes de producción. No se editan una vez publicadas.
12. **Estados con historial.** Reservas, pagos y tickets tienen una tabla `historial_estados`.

## Esquemas y tablas

| Esquema | Tablas |
|---|---|
| `identidad` | usuarios, organizaciones, membresias, invitaciones, sesiones |
| `geo` | paises, ciudades, ciudad_traducciones, zonas, idiomas, monedas, tipos_cambio |
| `catalogo` | hoteles, hotel_traducciones, tipos_habitacion, tipo_habitacion_traducciones, servicios, servicio_traducciones, hotel_servicios, tipo_habitacion_servicios, fotos, revisiones_contenido |
| `tarifas` | planes_tarifa, plan_tarifa_traducciones, reglas_margen, politicas_cancelacion, politica_reglas, impuestos, precios_dia, cupos_dia |
| `reservas` | reservas, reserva_lineas, reserva_noches, reserva_impuestos, historial_estados |
| `pagos` | proveedores, reglas_enrutamiento, pagos, eventos_pasarela, reembolsos, asientos, liquidaciones, liquidacion_lineas |
| `soporte` | conversaciones, mensajes, tickets, categorias, historial_estados, articulos_ayuda, articulo_traducciones |
| `experiencias` | experiencias, experiencia_traducciones, cotizaciones, cotizacion_lineas |
| `auditoria` | eventos, alertas |

Extensiones: `citext`, `pg_trgm`, `unaccent`, `btree_gist` y `postgis`.

El DDL completo de las tablas clave está en el artifact de arquitectura. El definitivo vivirá en `packages/db/migraciones/` a partir de la fase 1.

## Tablas clave (resumen)

- `tarifas.precios_dia`: **tarifa neta** por (plan, tipo de habitación, fecha, ocupación). El precio de venta no se guarda aquí, porque sería un dato duplicado.
- `tarifas.reglas_margen`: por hotel (obligatorio) y opcionalmente por plan. Puede ser en `porcentaje` o en `monto_fijo`, con vigencia. Un `EXCLUDE` impide que dos reglas del mismo alcance se solapen.
- `tarifas.cupos_dia`: `CHECK (cupo_vendido <= cupo_total)`. La base de datos impide la sobreventa.
- `reservas.reservas`: tiene `total_venta_centavos` y `anticipo_centavos`. `saldo_centavos` es una columna generada.
- `reservas.reserva_noches`: guarda `monto_neto_centavos` y `margen_centavos`. `monto_venta_centavos` es una columna generada.
- `pagos.eventos_pasarela`: su clave primaria es (proveedor, evento_id), lo que garantiza que cada webhook se procese una sola vez.
- `pagos.asientos`: libro contable de solo inserción. Reemplaza a `movimientos_financieros`.

## Migración desde el esquema actual

| Hoy | Pasa a | Nota |
|---|---|---|
| Filas de `tipos_habitacion` (en realidad son hoteles) | `catalogo.hoteles` + tipo “Estándar” | Ciudad Cartagena, país CO |
| `tipos_habitacion.servicios` (texto) | `servicios` + `hotel_servicios` | Se normalizan los nombres |
| `tarifas` (2 y 4 personas) | `precios_dia` (neto) + `reglas_margen` | Los precios actuales son de venta: hay que separar la neta y el margen con cada hotel |
| `solicitudes_reserva` | `reservas` (modo solicitud) + `historial_estados` | Se conservan los códigos |
| `movimientos_financieros` | `pagos.asientos` | El informe Excel se adapta |
| `mensajes_contacto` | `soporte.tickets` | Categoría “otro” |
| `actividad_sitio` | `auditoria.eventos` | |
| `reservas`, `habitaciones`, `bloqueos` | Se eliminan | No tienen datos ni uso |
