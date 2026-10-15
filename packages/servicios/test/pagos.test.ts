import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { crearBaseMigrada, type BaseDePrueba } from "@wopa/db/pruebas";
import { aceptarHotel, cargarCupos, cargarTarifaNeta, crearHotel, crearTipoHabitacion } from "../src/catalogo.ts";
import type { SesionActiva } from "../src/identidad.ts";
import {
  aprobarLiquidacion,
  cancelarConReembolso,
  conciliarPendientes,
  firmarSimulado,
  generarLiquidacion,
  iniciarPago,
  marcarLiquidacionPagada,
  opcionesDePago,
  procesarNotificacion,
  registrarProveedor,
  type EstadoPago,
  type ProveedorPago,
} from "../src/pagos/index.ts";
import { hashIpnYappy, ProveedorYappy } from "../src/pagos/proveedores/yappy.ts";
import { consultarReserva, crearReserva } from "../src/reservas.ts";
import { fecha, idCiudad, idPlanBase, sesionWopa } from "./ayudantes.ts";

let db: BaseDePrueba;
let wopa: SesionActiva;
let hotel: { hotelId: string; slug: string; plan: string; habitacion: string };
const correo = "viajero@example.test";

before(async () => {
  db = await crearBaseMigrada();
  wopa = await sesionWopa(db);
  const ciudad = await idCiudad(db, "ciudad-de-panama");
  const creado = await crearHotel(wopa, { nombre: "Hotel Pagos", ciudadId: ciudad, monedaCodigo: "USD", direccion: "Vía España", latitud: 8.98, longitud: -79.52 }, db);
  const habitacion = await crearTipoHabitacion(wopa, { hotelId: creado.hotelId, codigo: "doble", capacidadMaxima: 2, nombre: { es: "Doble" } }, db);
  const plan = await idPlanBase(db, creado.hotelId);
  await cargarTarifaNeta(wopa, { hotelId: creado.hotelId, planTarifaId: plan, tipoHabitacionId: habitacion, desde: fecha(1), hasta: fecha(120), ocupacion: 2, netoCentavos: 10_000n }, db);
  await cargarCupos(wopa, { hotelId: creado.hotelId, tipoHabitacionId: habitacion, desde: fecha(1), hasta: fecha(120), cupoTotal: 10 }, db);
  await aceptarHotel(wopa, { hotelId: creado.hotelId, margen: { tipo: "porcentaje", porcentajeBp: 3000 }, desde: fecha(0) }, db);
  hotel = { hotelId: creado.hotelId, slug: creado.slug, plan, habitacion };
});
after(async () => {
  await db.close();
});

async function nuevaReserva(entrada: number, salida: number) {
  return crearReserva({ hotelSlug: hotel.slug, tipoHabitacionId: hotel.habitacion, planTarifaId: hotel.plan, entrada: fecha(entrada), salida: fecha(salida), huespedes: 2, idioma: "es", titular: { nombre: "Viajero", correo, telefono: "+50760000000", paisCodigo: "PA" } }, db);
}

function notificacionSimulada(referenciaExterna: string, estado: "capturado" | "fallido", montoCentavos: string, eventoId = randomUUID()) {
  const cuerpo = JSON.stringify({ eventoId, referenciaExterna, estado, montoCentavos, moneda: "USD" });
  return { metodo: "POST", cabeceras: { "x-firma-simulada": firmarSimulado(cuerpo) }, consulta: {}, cuerpo };
}

async function pagarCompleto(codigo: string) {
  const resultado = await iniciarPago({ codigo, correo, metodo: "tarjeta", claveIdempotencia: randomUUID(), urlBase: "https://wopa.test" }, db);
  const reserva = await consultarReserva(codigo, correo, db);
  await procesarNotificacion("simulado", notificacionSimulada(resultado.referenciaExterna, "capturado", reserva!.anticipo), db);
  return resultado;
}

async function saldoCuenta(cuenta: string, reservaCodigo?: string): Promise<number> {
  const { rows } = await db.query<{ saldo: string | null }>(
    `SELECT sum(a.monto_centavos) AS saldo FROM pagos.asientos a LEFT JOIN reservas.reservas r ON r.id = a.reserva_id
     WHERE a.cuenta = $1 AND ($2::text IS NULL OR r.codigo = $2)`,
    [cuenta, reservaCodigo ?? null],
  );
  return Number(rows[0].saldo ?? 0);
}

describe("enrutamiento por país", () => {
  test("sin proveedores reales verificados, se ofrece la pasarela simulada", async () => {
    const opciones = await opcionesDePago({ paisCompradorCodigo: "PA", paisHotelCodigo: "PA", moneda: "USD" }, db);
    assert.deepEqual(opciones.map((o) => [o.metodo, o.proveedor]).sort(), [["billetera", "simulado"], ["tarjeta", "simulado"]]);
  });

  test("con Yappy activo y verificado, un comprador de Panamá ve Yappy; uno de Colombia no", async () => {
    const yappyFalso: ProveedorPago = { ...new ProveedorYappy(), codigo: "yappy", metodos: ["billetera"], monedas: ["USD"], disponible: () => true } as ProveedorPago;
    registrarProveedor(yappyFalso);
    await db.query("UPDATE pagos.proveedores SET esta_activo = true WHERE codigo = 'yappy'");
    const panama = await opcionesDePago({ paisCompradorCodigo: "PA", paisHotelCodigo: "PA", moneda: "USD" }, db);
    const colombia = await opcionesDePago({ paisCompradorCodigo: "CO", paisHotelCodigo: "PA", moneda: "USD" }, db);
    assert.equal(panama.find((o) => o.metodo === "billetera")?.proveedor, "yappy");
    assert.equal(colombia.find((o) => o.metodo === "billetera")?.proveedor, "simulado");
    await db.query("UPDATE pagos.proveedores SET esta_activo = false WHERE codigo = 'yappy'");
    registrarProveedor(new ProveedorYappy());
  });
});

describe("cobro del anticipo", () => {
  test("pagar confirma la reserva y registra asientos que cuadran", async () => {
    const reserva = await nuevaReserva(30, 32); // 2 noches × 130 = 260; anticipo 65; margen 60
    const resultado = await iniciarPago({ codigo: reserva.codigo, correo, metodo: "tarjeta", claveIdempotencia: randomUUID(), urlBase: "https://wopa.test" }, db);
    assert.equal(resultado.tipo, "redireccion");
    assert.match(resultado.tipo === "redireccion" ? resultado.url : "", /\/pagos\/simulado\/[0-9a-f-]{36}$/);
    assert.equal((await consultarReserva(reserva.codigo, correo, db))?.estado, "pendiente_pago");

    const procesado = await procesarNotificacion("simulado", notificacionSimulada(resultado.referenciaExterna, "capturado", "6500"), db);
    assert.deepEqual(procesado, { procesado: true });
    const confirmada = await consultarReserva(reserva.codigo, correo, db);
    assert.equal(confirmada?.estado, "confirmada");
    assert.equal(Number(confirmada?.pagado), 6_500);

    assert.equal(await saldoCuenta("caja_proveedor", reserva.codigo), 6_500);
    assert.equal(await saldoCuenta("ingreso_margen", reserva.codigo), -6_000);
    assert.equal(await saldoCuenta("por_pagar_hotel", reserva.codigo), -500);
    const correos = await db.query("SELECT 1 FROM notificaciones.correos WHERE plantilla = 'reserva_confirmada' AND para = $1", [correo]);
    assert.equal(correos.rows.length, 1);
  });

  test("la misma clave de idempotencia no crea un segundo cobro", async () => {
    const reserva = await nuevaReserva(40, 41);
    const clave = randomUUID();
    const primero = await iniciarPago({ codigo: reserva.codigo, correo, metodo: "tarjeta", claveIdempotencia: clave, urlBase: "https://wopa.test" }, db);
    const segundo = await iniciarPago({ codigo: reserva.codigo, correo, metodo: "tarjeta", claveIdempotencia: clave, urlBase: "https://wopa.test" }, db);
    assert.equal(primero.referenciaExterna, segundo.referenciaExterna);
    const pagos = await db.query("SELECT 1 FROM pagos.pagos p JOIN reservas.reservas r ON r.id = p.reserva_id WHERE r.codigo = $1", [reserva.codigo]);
    assert.equal(pagos.rows.length, 1);
  });

  test("un webhook repetido, con firma alterada o con otro monto no confirma dos veces ni a ciegas", async () => {
    const reserva = await nuevaReserva(45, 46);
    const { referenciaExterna } = await iniciarPago({ codigo: reserva.codigo, correo, metodo: "billetera", claveIdempotencia: randomUUID(), urlBase: "https://wopa.test" }, db);

    const alterada = notificacionSimulada(referenciaExterna, "capturado", "3250");
    await assert.rejects(procesarNotificacion("simulado", { ...alterada, cabeceras: { "x-firma-simulada": "00".repeat(32) } }, db), { codigo: "FIRMA_INVALIDA" });

    const otroMonto = await procesarNotificacion("simulado", notificacionSimulada(referenciaExterna, "capturado", "1"), db);
    assert.deepEqual(otroMonto, { procesado: false, motivo: "monto_no_coincide" });
    const alertas = await db.query("SELECT 1 FROM auditoria.alertas WHERE tipo = 'monto_pago_no_coincide'");
    assert.equal(alertas.rows.length, 1);

    const eventoId = randomUUID();
    assert.deepEqual(await procesarNotificacion("simulado", notificacionSimulada(referenciaExterna, "capturado", "3250", eventoId), db), { procesado: true });
    assert.deepEqual(await procesarNotificacion("simulado", notificacionSimulada(referenciaExterna, "capturado", "3250", eventoId), db), { procesado: false, motivo: "duplicado" });
  });
});

describe("cancelación con reembolso y liquidación", () => {
  test("cancelar a tiempo devuelve todo el anticipo y deja las cuentas de la reserva en cero", async () => {
    const reserva = await nuevaReserva(50, 52);
    await pagarCompleto(reserva.codigo);
    const resultado = await cancelarConReembolso({ codigo: reserva.codigo, correo }, db);
    assert.equal(resultado.reembolsoCentavos, 6_500n);
    assert.equal(resultado.reembolsoManual, false);
    for (const cuenta of ["caja_proveedor", "ingreso_margen", "por_pagar_hotel", "ingreso_penalizacion"]) {
      assert.equal(await saldoCuenta(cuenta, reserva.codigo), 0, cuenta);
    }
    const cupos = await db.query<{ vendido: number }>("SELECT max(cupo_vendido)::int AS vendido FROM tarifas.cupos_dia WHERE tipo_habitacion_id = $1 AND fecha BETWEEN $2 AND $3", [hotel.habitacion, fecha(50), fecha(51)]);
    assert.equal(cupos.rows[0].vendido, 0);
  });

  test("cancelar tarde retiene el anticipo: WOPA cobra hasta su margen y el resto se liquida al hotel", async () => {
    const reserva = await nuevaReserva(60, 62); // total 260, anticipo 65, margen 60
    await pagarCompleto(reserva.codigo);
    const resultado = await cancelarConReembolso({ codigo: reserva.codigo, correo, hoy: fecha(59) }, db);
    assert.equal(resultado.penalizacionCentavos, 6_500n); // 25 % del total
    assert.equal(resultado.reembolsoCentavos, 0n);
    assert.equal(await saldoCuenta("ingreso_penalizacion", reserva.codigo), -6_000);
    assert.equal(await saldoCuenta("por_pagar_hotel", reserva.codigo), -500);
    assert.equal(await saldoCuenta("caja_proveedor", reserva.codigo), 6_500);
  });

  test("la liquidación agrupa lo debido al hotel y al pagarla la deuda queda en cero", async () => {
    const liquidacion = await generarLiquidacion(wopa, { hotelId: hotel.hotelId, desde: fecha(0), hasta: fecha(200) }, db);
    assert.ok(liquidacion.liquidacionId);
    assert.equal(liquidacion.totalCentavos, 500n + 250n + 500n); // confirmadas a 30 días (2 noches) y 45 días (1 noche), y la cancelada tarde
    await assert.rejects(marcarLiquidacionPagada(wopa, liquidacion.liquidacionId!, "TRF-1", db), { codigo: "ESTADO_INVALIDO" });
    await aprobarLiquidacion(wopa, liquidacion.liquidacionId!, db);
    await marcarLiquidacionPagada(wopa, liquidacion.liquidacionId!, "TRF-2026-001", db);
    assert.equal(await saldoCuenta("por_pagar_hotel"), 0);
    const repetida = await generarLiquidacion(wopa, { hotelId: hotel.hotelId, desde: fecha(0), hasta: fecha(200) }, db);
    assert.equal(repetida.liquidacionId, null); // nada se liquida dos veces
  });

  test("en todo el libro, la suma de cada moneda es cero", async () => {
    const { rows } = await db.query<{ total: string }>("SELECT sum(monto_centavos) AS total FROM pagos.asientos");
    assert.equal(Number(rows[0].total), 0);
  });
});

describe("conciliación y Yappy", () => {
  test("la conciliación confirma un pago que el proveedor informa como capturado", async () => {
    const reserva = await nuevaReserva(70, 71);
    const { referenciaExterna } = await iniciarPago({ codigo: reserva.codigo, correo, metodo: "tarjeta", claveIdempotencia: randomUUID(), urlBase: "https://wopa.test" }, db);
    await db.query("UPDATE pagos.pagos SET creado_en = now() - interval '45 minutes' WHERE referencia_externa = $1", [referenciaExterna]);
    const simulado = { codigo: "simulado", metodos: ["tarjeta"], monedas: ["USD"], disponible: () => true, consultarPago: async (): Promise<EstadoPago> => "capturado" } as unknown as ProveedorPago;
    registrarProveedor(simulado);
    const resultado = await conciliarPendientes(db);
    assert.ok(resultado.actualizados >= 1);
    assert.equal((await consultarReserva(reserva.codigo, correo, db))?.estado, "confirmada");
  });

  test("Yappy: el IPN solo se acepta con el hash correcto y traduce los estados", async () => {
    Object.assign(process.env, { YAPPY_MERCHANT_ID: "M1", YAPPY_CLAVE_SECRETA: "clave", YAPPY_URL_API: "https://uat.yappy.test", YAPPY_DOMINIO: "https://wopa.test" });
    const yappy = new ProveedorYappy();
    assert.equal(yappy.disponible(), false); // falta YAPPY_VERIFICADO=1
    const hash = hashIpnYappy("clave", "ORDEN123", "E", "https://wopa.test");
    const evento = await yappy.verificarNotificacion({ metodo: "GET", cabeceras: {}, cuerpo: "", consulta: { orderId: "ORDEN123", status: "E", hash, domain: "https://wopa.test" } });
    assert.equal(evento.estado, "capturado");
    await assert.rejects(yappy.verificarNotificacion({ metodo: "GET", cabeceras: {}, cuerpo: "", consulta: { orderId: "ORDEN123", status: "E", hash: "x".repeat(64) } }));
  });
});
