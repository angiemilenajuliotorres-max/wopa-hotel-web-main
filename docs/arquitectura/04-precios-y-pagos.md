# 04 · Precios y pagos

## Precio al público

```
precio al público (por noche) = tarifa neta del hotel + margen de WOPA (+ redondeo según la moneda)
```

- El **hotel** carga la tarifa neta. No ve ni edita el margen en el sistema.
- **WOPA configura el margen de cada hotel al aceptarlo** y lo ajusta después ([ADR-008](../decisiones.md)). El margen puede ser un porcentaje sobre la neta o un monto fijo por noche, y puede variar por plan o temporada.
- Para cada noche gana la regla vigente más específica: plan > hotel. No existe un margen global.
- El redondeo (por ejemplo, a 1 USD) se suma al margen.
- Los impuestos se aplican según el país del hotel y se muestran incluidos. La base de cálculo debe validarla un contador.

## Anticipo

```
anticipo = máx(porcentaje_anticipo_del_plan × precio al público, margen total de la estadía)
saldo    = precio al público − anticipo        (lo cobra el hotel a la llegada)
```

| Ejemplo | Monto |
|---|---|
| Neta del hotel | 50.000 |
| Margen de WOPA | 15.000 |
| Precio al público | 65.000 |
| Anticipo en la web (25 %) | 16.250 |
| Saldo a pagar en el hotel | 48.750 |
| WOPA se queda con | 15.000 |
| WOPA liquida al hotel | 1.250 |
| Total para el hotel | 50.000 |

La comisión de la pasarela se cobra sobre el anticipo y sale del margen de WOPA. En una cancelación con penalización se retiene el anticipo; la parte que excede el margen se liquida al hotel.

## Pasarelas para el lanzamiento en Panamá

Tarifas públicas consultadas en octubre de 2026. **Deben confirmarse por escrito antes de firmar.**

| Proveedor | Métodos | Comisión publicada | Papel |
|---|---|---|---|
| Yappy Comercial (Banco General) | Billetera, botón de pago web, USD | 1 % + ITBMS (mín. 0,02 USD; máx. 10,70 USD) | Lanzamiento |
| PagueloFacil | Tarjetas, Sistema Clave, Nequi | No publicada; +1 % si el pago viene de otro país | Lanzamiento (tarjetas), según cotización |
| Banco adquirente (BAC, Banco General) | Tarjetas con 3-D Secure | Negociada | Alternativa a PagueloFacil |
| PayPal | Saldo PayPal, tarjetas | 5,40 % + tarifa fija; 4,5 % por conversión de divisa | Opcional |
| Wompi / PayU (Colombia) | PSE, Nequi, tarjetas en COP | 2,65 % + 700 COP + IVA / 3,29 % + 300 COP + IVA | Fase 6 |
| Stripe | — | — | Descartado: no opera para empresas de Panamá |

## Diseño intercambiable

- Interfaz `ProveedorPago`: `crearPago`, `consultarPago`, `reembolsar`, `verificarWebhook`, más sus `capacidades` (métodos y monedas).
- Registro de adaptadores en código. Las credenciales vienen de variables de entorno, nunca de la base de datos.
- `pagos.reglas_enrutamiento` define (proveedor, método, país del comprador, país del hotel, moneda, prioridad). Gana la regla más específica. Si un proveedor está inactivo, se salta.
- **Agregar un país** = escribir un adaptador, registrarlo, cargar sus credenciales e insertar sus reglas. El checkout no cambia.

## Flujo de cobro

1. `POST /api/v1/reservas/:codigo/pagos` con `Idempotency-Key`.
2. El enrutador elige el proveedor; se crea el `pago` en estado `pendiente`.
3. El adaptador devuelve una redirección, un formulario o un QR.
4. El proveedor llama al webhook firmado. Se verifica la firma y se registra el evento una sola vez. Si el monto coincide, el pago pasa a `capturado`, la reserva a `confirmada` y se generan los asientos (`ingreso_margen`, `por_pagar_hotel`, `comision_pasarela`).
5. La reserva **nunca** se confirma por la URL de retorno. Cada 10 minutos, una tarea consulta los pagos pendientes con más de 30 minutos.

## Seguridad

- Los datos de tarjeta solo pasan por el formulario o la página del proveedor (alcance PCI SAQ A).
- Se compara el monto del webhook con el esperado; si no coincide, se crea una alerta en lugar de confirmar.
- Conciliación diaria con el reporte del proveedor.
