/**
 * Pagos (ADR-006, ADR-007): enrutamiento por país, cobro del anticipo, webhooks idempotentes,
 * libro contable de partida doble, cancelación con reembolso, conciliación y liquidaciones a hoteles.
 */
import { randomUUID } from "node:crypto";
import { calcularCancelacion, diasEntre } from "@wopa/dominio/reservas";
import { crearAlerta, registrarEvento } from "../auditoria.ts";
import { db, enTransaccion, ErrorNegocio, type Consulta } from "../conexion.ts";
import { esWopa, hotelesDe, type SesionActiva } from "../identidad.ts";
import { encolarCorreo } from "../notificaciones.ts";
import { confirmarReserva, consultarReserva, formatoDinero, marcarPendientePago } from "../reservas.ts";
import { ProveedorPagueloFacil } from "./proveedores/paguelofacil.ts";
import { ProveedorSimulado } from "./proveedores/simulado.ts";
import { ProveedorWompi } from "./proveedores/wompi.ts";
import { ProveedorYappy } from "./proveedores/yappy.ts";
import { ErrorFirmaInvalida, ErrorProveedor, type EstadoPago, type EventoPago, type MetodoPago, type NotificacionEntrante, type ProveedorPago, type ResultadoCreacion } from "./tipos.ts";

export * from "./tipos.ts";
export { firmarSimulado, type NotificacionSimulada } from "./proveedores/simulado.ts";

export const MINUTOS_PARA_PAGAR = 30;

// ---------------------------------------------------------------- registro de proveedores

let registro: Map<string, ProveedorPago> | undefined;

export function proveedores(): Map<string, ProveedorPago> {
  registro ??= new Map<string, ProveedorPago>(
    [new ProveedorSimulado(process.env.URL_PUBLICA ?? "http://localhost:3100"), new ProveedorYappy(), new ProveedorPagueloFacil(), new ProveedorWompi()].map((p) => [p.codigo, p]),
  );
  return registro;
}

/** Solo para pruebas: reemplaza un proveedor. */
export function registrarProveedor(proveedor: ProveedorPago): void {
  proveedores().set(proveedor.codigo, proveedor);
}

// ---------------------------------------------------------------- enrutamiento

export interface OpcionPago {
  metodo: MetodoPago;
  proveedor: string;
  moneda: string;
}

/**
 * Métodos de pago que verá el viajero: una opción por método, de la regla más específica
 * (país del comprador y del hotel) y de menor prioridad, entre proveedores activos y disponibles.
 */
export async function opcionesDePago(
  contexto: { paisCompradorCodigo?: string | null; paisHotelCodigo: string; moneda: string },
  cliente?: Consulta,
): Promise<OpcionPago[]> {
  const { rows } = await db(cliente).query<{ proveedor_codigo: string; metodo: MetodoPago }>(
    `SELECT r.proveedor_codigo, r.metodo FROM pagos.reglas_enrutamiento r
     JOIN pagos.proveedores p ON p.codigo = r.proveedor_codigo AND p.esta_activo
     WHERE r.esta_activa AND r.moneda_codigo = $3
       AND (r.pais_comprador_codigo IS NULL OR r.pais_comprador_codigo = $1)
       AND (r.pais_hotel_codigo IS NULL OR r.pais_hotel_codigo = $2)
     ORDER BY (r.pais_comprador_codigo IS NOT NULL)::int + (r.pais_hotel_codigo IS NOT NULL)::int DESC, r.prioridad`,
    [contexto.paisCompradorCodigo ?? null, contexto.paisHotelCodigo, contexto.moneda],
  );
  const elegidas = new Map<MetodoPago, OpcionPago>();
  for (const regla of rows) {
    if (elegidas.has(regla.metodo)) continue;
    const proveedor = proveedores().get(regla.proveedor_codigo);
    if (!proveedor?.disponible() || !proveedor.monedas.includes(contexto.moneda)) continue; // respaldo automático
    elegidas.set(regla.metodo, { metodo: regla.metodo, proveedor: proveedor.codigo, moneda: contexto.moneda });
  }
  return [...elegidas.values()];
}

// ---------------------------------------------------------------- inicio del pago

/** Opciones de pago para una reserva concreta (la web las muestra en la página de la reserva). */
export async function opcionesParaReserva(codigo: string, correo: string, cliente?: Consulta): Promise<OpcionPago[]> {
  const conexion = db(cliente);
  const fila = (await conexion.query<{ pais_hotel: string; pais_comprador: string | null; moneda: string }>(
    `SELECT c.pais_codigo AS pais_hotel, r.titular_pais_codigo AS pais_comprador, r.moneda_codigo AS moneda
     FROM reservas.reservas r JOIN catalogo.hoteles h ON h.id = r.hotel_id JOIN geo.ciudades c ON c.id = h.ciudad_id
     WHERE r.codigo = $1 AND r.titular_correo = $2`,
    [codigo.toUpperCase(), correo.toLowerCase()],
  )).rows[0];
  if (!fila) return [];
  return opcionesDePago({ paisCompradorCodigo: fila.pais_comprador, paisHotelCodigo: fila.pais_hotel, moneda: fila.moneda }, conexion);
}

/**
 * Inicia el cobro del anticipo. La clave de idempotencia (del formulario) evita cobros duplicados
 * si el navegador reenvía la petición. Devuelve a dónde llevar al viajero.
 */
export async function iniciarPago(
  datos: { codigo: string; correo: string; metodo: MetodoPago; claveIdempotencia: string; urlBase: string },
  cliente?: Consulta,
): Promise<ResultadoCreacion> {
  if (!/^[0-9a-f-]{36}$/i.test(datos.claveIdempotencia)) throw new ErrorNegocio("DATOS_INVALIDOS", "Solicitud de pago inválida.");
  const conexion = db(cliente);
  const previo = (await conexion.query<{ datos_proveedor: ResultadoCreacion | null }>(
    "SELECT datos_proveedor FROM pagos.pagos WHERE clave_idempotencia = $1", [datos.claveIdempotencia],
  )).rows[0];
  if (previo?.datos_proveedor) return previo.datos_proveedor;

  const reserva = await consultarReserva(datos.codigo, datos.correo, conexion);
  if (!reserva) throw new ErrorNegocio("RESERVA_NO_ENCONTRADA", "No encontramos la reserva.", { estado: 404 });
  if (!["retenida", "pendiente_pago"].includes(reserva.estado)) throw new ErrorNegocio("NO_PAGABLE", "Esta reserva no tiene un pago pendiente.", { estado: 409 });
  if (BigInt(reserva.pagado) >= BigInt(reserva.anticipo)) throw new ErrorNegocio("YA_PAGADA", "El anticipo ya está pagado.", { estado: 409 });

  const opcion = (await opcionesParaReserva(datos.codigo, datos.correo, conexion)).find((o) => o.metodo === datos.metodo);
  if (!opcion) throw new ErrorNegocio("METODO_NO_DISPONIBLE", "Ese método de pago no está disponible.", { campo: "metodo" });
  const proveedor = proveedores().get(opcion.proveedor)!;
  const monto = BigInt(reserva.anticipo) - BigInt(reserva.pagado);

  const pago = await enTransaccion(async (tx) => {
    // Extiende el plazo mientras el viajero completa el pago en la página del proveedor.
    await marcarPendientePago(reserva.id, tx);
    await tx.query(
      "UPDATE reservas.reservas SET retenida_hasta = greatest(retenida_hasta, now() + make_interval(mins => $2)) WHERE id = $1",
      [reserva.id, MINUTOS_PARA_PAGAR],
    );
    return (await tx.query<{ id: string }>(
      `INSERT INTO pagos.pagos (reserva_id, proveedor_codigo, metodo, concepto, monto_centavos, moneda_codigo, clave_idempotencia)
       VALUES ($1, $2, $3, 'anticipo', $4, $5, $6) RETURNING id`,
      [reserva.id, proveedor.codigo, datos.metodo, monto.toString(), reserva.moneda, datos.claveIdempotencia],
    )).rows[0];
  }, cliente);

  try {
    const resultado = await proveedor.crearPago({
      pagoId: pago.id,
      reservaCodigo: reserva.codigo,
      monto: { centavos: monto, moneda: reserva.moneda },
      metodo: datos.metodo,
      descripcion: `${reserva.idioma === "es" ? "Anticipo" : "Deposit"} ${reserva.codigo} · ${reserva.hotel}`,
      comprador: { nombre: reserva.titular_nombre, correo: datos.correo },
      idioma: reserva.idioma,
      urlRetorno: `${datos.urlBase}/${reserva.idioma}/reservar/${reserva.codigo}?pago=${pago.id}`,
      urlNotificacion: `${datos.urlBase}/api/v1/pagos/webhooks/${proveedor.codigo}`,
      claveIdempotencia: datos.claveIdempotencia,
    });
    await conexion.query("UPDATE pagos.pagos SET referencia_externa = $2, datos_proveedor = $3 WHERE id = $1", [
      pago.id, resultado.referenciaExterna, JSON.stringify(resultado),
    ]);
    return resultado;
  } catch (error) {
    await conexion.query("UPDATE pagos.pagos SET estado = 'fallido' WHERE id = $1", [pago.id]);
    if (error instanceof ErrorProveedor) throw new ErrorNegocio("PROVEEDOR_NO_DISPONIBLE", "El medio de pago no respondió. Prueba otro método o inténtalo en unos minutos.", { estado: 502 });
    throw error;
  }
}

// ---------------------------------------------------------------- notificaciones (webhooks)

const TRANSICIONES: Record<string, EstadoPago[]> = {
  pendiente: ["autorizado", "capturado", "fallido", "cancelado"],
  autorizado: ["capturado", "fallido", "cancelado"],
  capturado: ["reembolsado_parcial", "reembolsado"],
  reembolsado_parcial: ["reembolsado"],
};

/** Asientos al capturar el anticipo: entra caja; se reconoce el margen de WOPA y lo que se debe al hotel. */
async function asientosDeCobro(tx: Consulta, pago: { id: string; reserva_id: string; monto_centavos: string; moneda_codigo: string }): Promise<void> {
  const margen = BigInt((await tx.query<{ margen: string }>(
    `SELECT coalesce(sum(n.margen_centavos), 0) AS margen FROM reservas.reserva_noches n
     JOIN reservas.reserva_lineas l ON l.id = n.reserva_linea_id WHERE l.reserva_id = $1`,
    [pago.reserva_id],
  )).rows[0].margen);
  const cobrado = BigInt(pago.monto_centavos);
  const ingreso = margen < cobrado ? margen : cobrado;
  const operacion = randomUUID();
  const lineas: [string, bigint][] = [["caja_proveedor", cobrado], ["ingreso_margen", -ingreso], ["por_pagar_hotel", -(cobrado - ingreso)]];
  for (const [cuenta, monto] of lineas.filter(([, m]) => m !== 0n)) {
    await tx.query(
      `INSERT INTO pagos.asientos (operacion_id, cuenta, monto_centavos, moneda_codigo, descripcion, pago_id, reserva_id)
       VALUES ($1, $2, $3, $4, 'Anticipo capturado', $5, $6)`,
      [operacion, cuenta, monto.toString(), pago.moneda_codigo, pago.id, pago.reserva_id],
    );
  }
}

/**
 * Procesa una notificación del proveedor: verifica la firma, la registra una sola vez,
 * compara el monto, aplica la transición y confirma la reserva cuando el anticipo queda capturado.
 */
export async function procesarNotificacion(codigoProveedor: string, notificacion: NotificacionEntrante, cliente?: Consulta): Promise<{ procesado: boolean; motivo?: string }> {
  const proveedor = proveedores().get(codigoProveedor);
  if (!proveedor) throw new ErrorNegocio("PROVEEDOR_DESCONOCIDO", "Proveedor desconocido.", { estado: 404 });
  let evento: EventoPago;
  try {
    evento = await proveedor.verificarNotificacion(notificacion);
  } catch (error) {
    if (error instanceof ErrorFirmaInvalida) throw new ErrorNegocio("FIRMA_INVALIDA", "Firma inválida.", { estado: 401 });
    throw error;
  }
  return aplicarEvento(proveedor.codigo, evento, cliente);
}

export async function aplicarEvento(codigoProveedor: string, evento: EventoPago, cliente?: Consulta): Promise<{ procesado: boolean; motivo?: string }> {
  return enTransaccion(async (tx) => {
    const nuevo = await tx.query(
      `INSERT INTO pagos.eventos_pasarela (proveedor_codigo, evento_id, tipo, payload) VALUES ($1, $2, $3, $4)
       ON CONFLICT (proveedor_codigo, evento_id) DO NOTHING`,
      [codigoProveedor, evento.eventoId, evento.estado, JSON.stringify(evento.crudo ?? {})],
    );
    if (!nuevo.rowCount) return { procesado: false, motivo: "duplicado" };

    const pago = (await tx.query<{ id: string; reserva_id: string; estado: string; monto_centavos: string; moneda_codigo: string }>(
      "SELECT id, reserva_id, estado, monto_centavos, moneda_codigo FROM pagos.pagos WHERE proveedor_codigo = $1 AND referencia_externa = $2 FOR UPDATE",
      [codigoProveedor, evento.referenciaExterna],
    )).rows[0];
    if (!pago) return { procesado: false, motivo: "pago_desconocido" };
    await tx.query("UPDATE pagos.eventos_pasarela SET pago_id = $3 WHERE proveedor_codigo = $1 AND evento_id = $2", [codigoProveedor, evento.eventoId, pago.id]);

    if (evento.monto && (evento.monto.centavos !== BigInt(pago.monto_centavos) || evento.monto.moneda !== pago.moneda_codigo)) {
      await crearAlerta(
        { tipo: "monto_pago_no_coincide", severidad: "critica", entidad: "pago", entidadId: pago.id, detalle: { esperado: pago.monto_centavos, recibido: evento.monto.centavos.toString(), proveedor: codigoProveedor } },
        tx,
      );
      return { procesado: false, motivo: "monto_no_coincide" };
    }
    if (!(TRANSICIONES[pago.estado] ?? []).includes(evento.estado)) return { procesado: false, motivo: "transicion_invalida" };

    await tx.query("UPDATE pagos.pagos SET estado = $2 WHERE id = $1", [pago.id, evento.estado]);
    if (evento.estado === "capturado") {
      await asientosDeCobro(tx, pago);
      await confirmarReserva(pago.reserva_id, tx);
    }
    await tx.query("UPDATE pagos.eventos_pasarela SET procesado_en = now() WHERE proveedor_codigo = $1 AND evento_id = $2", [codigoProveedor, evento.eventoId]);
    await registrarEvento({ entidad: "pago", entidadId: pago.id, accion: `pago_${evento.estado}`, actor: { tipo: "proveedor" }, despues: { proveedor: codigoProveedor, evento: evento.eventoId } }, tx);
    return { procesado: true };
  }, cliente);
}

/** Estado de los pagos de una reserva (página de retorno: nunca confirma por sí misma). */
export async function pagosDeReserva(reservaId: string, cliente?: Consulta) {
  const { rows } = await db(cliente).query<{ id: string; estado: string; proveedor_codigo: string; metodo: string; monto_centavos: string; moneda_codigo: string; creado_en: Date }>(
    "SELECT id, estado, proveedor_codigo, metodo, monto_centavos, moneda_codigo, creado_en FROM pagos.pagos WHERE reserva_id = $1 ORDER BY creado_en DESC",
    [reservaId],
  );
  return rows;
}

export async function datosPagoSimulado(pagoId: string, cliente?: Consulta) {
  const { rows } = await db(cliente).query<{ id: string; estado: string; monto_centavos: string; moneda_codigo: string; referencia_externa: string; codigo: string; idioma: "es" | "en"; hotel: string }>(
    `SELECT p.id, p.estado, p.monto_centavos, p.moneda_codigo, p.referencia_externa, r.codigo, r.idioma_codigo AS idioma, h.nombre AS hotel
     FROM pagos.pagos p JOIN reservas.reservas r ON r.id = p.reserva_id JOIN catalogo.hoteles h ON h.id = r.hotel_id
     WHERE p.id = $1 AND p.proveedor_codigo = 'simulado'`,
    [pagoId],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- cancelación con reembolso

/**
 * Cancela por el viajero aplicando la política congelada y devuelve lo que corresponda.
 * Asientos: se revierten margen y deuda con el hotel, sale de caja el reembolso y la penalización
 * se reparte: WOPA retiene hasta su margen y el excedente se liquida al hotel (ADR-008).
 */
export async function cancelarConReembolso(
  datos: { codigo: string; correo: string; motivo?: string; hoy?: string },
  cliente?: Consulta,
): Promise<{ penalizacionCentavos: bigint; reembolsoCentavos: bigint; reembolsoManual: boolean }> {
  return enTransaccion(async (tx) => {
    const reserva = await consultarReserva(datos.codigo, datos.correo, tx);
    if (!reserva) throw new ErrorNegocio("RESERVA_NO_ENCONTRADA", "No encontramos una reserva con ese código y correo.", { estado: 404 });
    if (!["retenida", "pendiente_pago", "solicitada", "confirmada"].includes(reserva.estado)) throw new ErrorNegocio("NO_CANCELABLE", "Esta reserva ya no se puede cancelar.", { estado: 409 });

    const pagado = BigInt(reserva.pagado);
    const { penalizacionCentavos, reembolsoCentavos } = calcularCancelacion({
      reglas: reserva.politica.reglas,
      diasAntesLlegada: diasEntre(datos.hoy ?? new Date().toISOString().slice(0, 10), reserva.fecha_entrada),
      totalCentavos: BigInt(reserva.total),
      pagadoCentavos: pagado,
    });

    const modo = (await tx.query<{ modo: string }>("SELECT h.modo_reserva AS modo FROM catalogo.hoteles h JOIN reservas.reservas r ON r.hotel_id = h.id WHERE r.id = $1", [reserva.id])).rows[0].modo;
    if (modo === "anticipo_en_linea" && reserva.estado !== "solicitada") {
      await tx.query(
        `UPDATE tarifas.cupos_dia c SET cupo_vendido = c.cupo_vendido - l.cantidad
         FROM reservas.reserva_lineas l, reservas.reserva_noches n
         WHERE l.reserva_id = $1 AND n.reserva_linea_id = l.id AND c.tipo_habitacion_id = l.tipo_habitacion_id AND c.fecha = n.fecha`,
        [reserva.id],
      );
    }
    await tx.query("UPDATE reservas.reservas SET estado = 'cancelada', retenida_hasta = NULL WHERE id = $1", [reserva.id]);

    let reembolsoManual = false;
    if (pagado > 0n) {
      const pago = (await tx.query<{ id: string; proveedor_codigo: string; referencia_externa: string; moneda_codigo: string }>(
        "SELECT id, proveedor_codigo, referencia_externa, moneda_codigo FROM pagos.pagos WHERE reserva_id = $1 AND estado = 'capturado' ORDER BY creado_en LIMIT 1",
        [reserva.id],
      )).rows[0];
      // Revertir lo reconocido al cobrar y registrar la salida de caja y la penalización.
      const saldos = (await tx.query<{ cuenta: string; total: string }>(
        "SELECT cuenta, sum(monto_centavos) AS total FROM pagos.asientos WHERE reserva_id = $1 AND cuenta IN ('ingreso_margen', 'por_pagar_hotel') GROUP BY cuenta",
        [reserva.id],
      )).rows;
      const margenReconocido = -BigInt(saldos.find((s) => s.cuenta === "ingreso_margen")?.total ?? "0");
      const deudaHotel = -BigInt(saldos.find((s) => s.cuenta === "por_pagar_hotel")?.total ?? "0");
      const paraWopa = penalizacionCentavos < margenReconocido ? penalizacionCentavos : margenReconocido;
      const paraHotel = penalizacionCentavos - paraWopa;
      const operacion = randomUUID();
      const lineas: [string, bigint][] = [
        ["ingreso_margen", margenReconocido],
        ["por_pagar_hotel", deudaHotel - paraHotel],
        ["caja_proveedor", -reembolsoCentavos],
        ["ingreso_penalizacion", -paraWopa],
      ];
      for (const [cuenta, monto] of lineas.filter(([, m]) => m !== 0n)) {
        await tx.query(
          `INSERT INTO pagos.asientos (operacion_id, cuenta, monto_centavos, moneda_codigo, descripcion, pago_id, reserva_id)
           VALUES ($1, $2, $3, $4, 'Cancelación por el viajero', $5, $6)`,
          [operacion, cuenta, monto.toString(), reserva.moneda, pago?.id ?? null, reserva.id],
        );
      }

      if (reembolsoCentavos > 0n && pago) {
        const reembolso = (await tx.query<{ id: string }>(
          "INSERT INTO pagos.reembolsos (pago_id, monto_centavos, motivo) VALUES ($1, $2, $3) RETURNING id",
          [pago.id, reembolsoCentavos.toString(), datos.motivo ?? "Cancelación por el viajero"],
        )).rows[0];
        try {
          const { referencia } = await proveedores().get(pago.proveedor_codigo)!.reembolsar(pago.referencia_externa, { centavos: reembolsoCentavos, moneda: pago.moneda_codigo }, "Cancelación");
          await tx.query("UPDATE pagos.reembolsos SET estado = 'completado', referencia_externa = $2, completado_en = now() WHERE id = $1", [reembolso.id, referencia]);
          await tx.query("UPDATE pagos.pagos SET estado = $2 WHERE id = $1", [pago.id, reembolsoCentavos === pagado ? "reembolsado" : "reembolsado_parcial"]);
        } catch (error) {
          if (!(error instanceof ErrorProveedor)) throw error;
          reembolsoManual = true; // queda pendiente para que finanzas lo haga desde el portal del proveedor
          await crearAlerta({ tipo: "otra", severidad: "critica", entidad: "reembolso", entidadId: reembolso.id, detalle: { motivo: "Reembolso manual pendiente", proveedor: pago.proveedor_codigo, monto: reembolsoCentavos.toString() } }, tx);
        }
      }
    }

    const es = reserva.idioma === "es";
    const correo = datos.correo.trim().toLowerCase();
    await encolarCorreo(
      {
        para: correo,
        plantilla: "reserva_cancelada",
        idioma: reserva.idioma,
        asunto: es ? `Reserva cancelada ${reserva.codigo}` : `Booking cancelled ${reserva.codigo}`,
        texto: es
          ? `Hola ${reserva.titular_nombre}:\n\nCancelamos tu reserva en ${reserva.hotel}.${reembolsoCentavos > 0n ? ` Te devolveremos ${formatoDinero(reembolsoCentavos, reserva.moneda, "es")} al mismo medio de pago.` : ""}`
          : `Hi ${reserva.titular_nombre},\n\nWe cancelled your booking at ${reserva.hotel}.${reembolsoCentavos > 0n ? ` We'll refund ${formatoDinero(reembolsoCentavos, reserva.moneda, "en")} to your original payment method.` : ""}`,
      },
      tx,
    );
    await registrarEvento({ entidad: "reserva", entidadId: reserva.id, accion: "cancelada_por_viajero", actor: { tipo: "sistema" }, detalle: datos.motivo, despues: { penalizacion: penalizacionCentavos.toString(), reembolso: reembolsoCentavos.toString() } }, tx);
    return { penalizacionCentavos, reembolsoCentavos, reembolsoManual };
  }, cliente);
}

// ---------------------------------------------------------------- conciliación

/** Consulta al proveedor los pagos pendientes de más de 30 minutos; alerta si siguen sin respuesta. */
export async function conciliarPendientes(cliente?: Consulta): Promise<{ revisados: number; actualizados: number }> {
  const conexion = db(cliente);
  const pendientes = (await conexion.query<{ id: string; proveedor_codigo: string; referencia_externa: string | null; minutos: number }>(
    `SELECT id, proveedor_codigo, referencia_externa, extract(epoch FROM now() - creado_en)::int / 60 AS minutos
     FROM pagos.pagos WHERE estado IN ('pendiente', 'autorizado') AND creado_en < now() - interval '30 minutes' LIMIT 50`,
  )).rows;
  let actualizados = 0;
  for (const pago of pendientes) {
    const proveedor = proveedores().get(pago.proveedor_codigo);
    let estado: EstadoPago | null = null;
    try {
      estado = pago.referencia_externa && proveedor ? await proveedor.consultarPago(pago.referencia_externa) : null;
    } catch {
      estado = null;
    }
    if (estado && estado !== "pendiente") {
      const resultado = await aplicarEvento(pago.proveedor_codigo, { eventoId: `conciliacion:${pago.id}:${estado}`, referenciaExterna: pago.referencia_externa!, estado, crudo: { origen: "conciliacion" } }, cliente);
      if (resultado.procesado) actualizados++;
    } else if (pago.minutos > 120) {
      await crearAlerta({ tipo: "pago_pendiente_vencido", severidad: "advertencia", entidad: "pago", entidadId: pago.id, detalle: { proveedor: pago.proveedor_codigo, minutos: pago.minutos } }, conexion);
    }
  }
  return { revisados: pendientes.length, actualizados };
}

// ---------------------------------------------------------------- liquidaciones a hoteles

function exigirFinanzas(sesion: SesionActiva): void {
  if (!esWopa(sesion, ["wopa_admin", "wopa_finanzas"])) throw new ErrorNegocio("SIN_PERMISO", "Solo para finanzas de WOPA.", { estado: 403 });
}

/**
 * Agrupa lo que WOPA debe al hotel por estadías con salida en el periodo (confirmadas, completadas o
 * canceladas con penalización a favor del hotel) que aún no se liquidaron.
 */
export async function generarLiquidacion(
  sesion: SesionActiva,
  datos: { hotelId: string; desde: string; hasta: string },
  cliente?: Consulta,
): Promise<{ liquidacionId: string | null; reservas: number; totalCentavos: bigint }> {
  exigirFinanzas(sesion);
  return enTransaccion(async (tx) => {
    const deudas = (await tx.query<{ reserva_id: string; moneda: string; deuda: string }>(
      `SELECT r.id AS reserva_id, a.moneda_codigo AS moneda, -sum(a.monto_centavos) AS deuda
       FROM reservas.reservas r JOIN pagos.asientos a ON a.reserva_id = r.id AND a.cuenta = 'por_pagar_hotel'
       WHERE r.hotel_id = $1 AND r.fecha_salida BETWEEN $2 AND $3
         AND r.estado IN ('confirmada', 'completada', 'cancelada', 'no_show')
         AND NOT EXISTS (SELECT 1 FROM pagos.liquidacion_lineas ll WHERE ll.reserva_id = r.id)
       GROUP BY r.id, a.moneda_codigo HAVING -sum(a.monto_centavos) > 0`,
      [datos.hotelId, datos.desde, datos.hasta],
    )).rows;
    if (deudas.length === 0) return { liquidacionId: null, reservas: 0, totalCentavos: 0n };
    const monedas = new Set(deudas.map((d) => d.moneda));
    if (monedas.size > 1) throw new ErrorNegocio("MONEDAS_MEZCLADAS", "Las reservas del periodo están en monedas distintas.", { estado: 409 });

    const liquidacion = (await tx.query<{ id: string }>(
      "INSERT INTO pagos.liquidaciones (hotel_id, periodo_desde, periodo_hasta, moneda_codigo, creado_por) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [datos.hotelId, datos.desde, datos.hasta, deudas[0].moneda, sesion.usuario.id],
    )).rows[0];
    let total = 0n;
    for (const deuda of deudas) {
      await tx.query("INSERT INTO pagos.liquidacion_lineas (liquidacion_id, reserva_id, monto_centavos) VALUES ($1, $2, $3)", [liquidacion.id, deuda.reserva_id, deuda.deuda]);
      total += BigInt(deuda.deuda);
    }
    await registrarEvento({ entidad: "liquidacion", entidadId: liquidacion.id, accion: "generada", actor: { tipo: "usuario", usuarioId: sesion.usuario.id }, despues: { total: total.toString(), reservas: deudas.length } }, tx);
    return { liquidacionId: liquidacion.id, reservas: deudas.length, totalCentavos: total };
  }, cliente);
}

export async function aprobarLiquidacion(sesion: SesionActiva, liquidacionId: string, cliente?: Consulta): Promise<void> {
  exigirFinanzas(sesion);
  const { rowCount } = await db(cliente).query("UPDATE pagos.liquidaciones SET estado = 'aprobada', aprobado_por = $2 WHERE id = $1 AND estado = 'borrador'", [liquidacionId, sesion.usuario.id]);
  if (!rowCount) throw new ErrorNegocio("ESTADO_INVALIDO", "La liquidación no está en borrador.", { estado: 409 });
}

/** Registra la transferencia al hotel: sale de caja y se cancela la deuda. */
export async function marcarLiquidacionPagada(sesion: SesionActiva, liquidacionId: string, referencia: string, cliente?: Consulta): Promise<void> {
  exigirFinanzas(sesion);
  if (referencia.trim().length < 3) throw new ErrorNegocio("REFERENCIA_OBLIGATORIA", "Escribe la referencia de la transferencia.", { campo: "referencia" });
  await enTransaccion(async (tx) => {
    const liquidacion = (await tx.query<{ moneda_codigo: string }>(
      "UPDATE pagos.liquidaciones SET estado = 'pagada', pagado_en = now(), referencia_transferencia = $2 WHERE id = $1 AND estado = 'aprobada' RETURNING moneda_codigo",
      [liquidacionId, referencia.trim()],
    )).rows[0];
    if (!liquidacion) throw new ErrorNegocio("ESTADO_INVALIDO", "La liquidación debe estar aprobada.", { estado: 409 });
    const lineas = (await tx.query<{ reserva_id: string; monto_centavos: string }>("SELECT reserva_id, monto_centavos FROM pagos.liquidacion_lineas WHERE liquidacion_id = $1", [liquidacionId])).rows;
    const operacion = randomUUID();
    let total = 0n;
    for (const linea of lineas) {
      await tx.query(
        `INSERT INTO pagos.asientos (operacion_id, cuenta, monto_centavos, moneda_codigo, descripcion, reserva_id, liquidacion_id, creado_por)
         VALUES ($1, 'por_pagar_hotel', $2, $3, 'Liquidación pagada al hotel', $4, $5, $6)`,
        [operacion, linea.monto_centavos, liquidacion.moneda_codigo, linea.reserva_id, liquidacionId, sesion.usuario.id],
      );
      total += BigInt(linea.monto_centavos);
    }
    await tx.query(
      `INSERT INTO pagos.asientos (operacion_id, cuenta, monto_centavos, moneda_codigo, descripcion, liquidacion_id, creado_por)
       VALUES ($1, 'caja_proveedor', $2, $3, $4, $5, $6)`,
      [operacion, (-total).toString(), liquidacion.moneda_codigo, `Transferencia al hotel ${referencia.trim()}`, liquidacionId, sesion.usuario.id],
    );
    await registrarEvento({ entidad: "liquidacion", entidadId: liquidacionId, accion: "pagada", actor: { tipo: "usuario", usuarioId: sesion.usuario.id }, despues: { referencia } }, tx);
  }, cliente);
}

/** El hotel o WOPA registran que el huésped pagó el saldo en el hotel. */
export async function marcarSaldoCobrado(sesion: SesionActiva, reservaId: string, cliente?: Consulta): Promise<void> {
  await enTransaccion(async (tx) => {
    const fila = (await tx.query<{ organizacion_id: string }>(
      "SELECT h.organizacion_id FROM reservas.reservas r JOIN catalogo.hoteles h ON h.id = r.hotel_id WHERE r.id = $1", [reservaId],
    )).rows[0];
    if (!fila || (!esWopa(sesion, ["wopa_admin", "wopa_operaciones"]) && !hotelesDe(sesion).includes(fila.organizacion_id))) {
      throw new ErrorNegocio("SIN_PERMISO", "No tienes acceso a esta reserva.", { estado: 403 });
    }
    const { rowCount } = await tx.query("UPDATE reservas.reservas SET saldo_cobrado_en = now() WHERE id = $1 AND estado IN ('confirmada', 'completada') AND saldo_cobrado_en IS NULL", [reservaId]);
    if (!rowCount) throw new ErrorNegocio("ESTADO_INVALIDO", "La reserva no está confirmada o el saldo ya estaba registrado.", { estado: 409 });
    await registrarEvento({ entidad: "reserva", entidadId: reservaId, accion: "saldo_cobrado_en_hotel", actor: { tipo: "usuario", usuarioId: sesion.usuario.id } }, tx);
  }, cliente);
}

/** Marca como completadas las reservas confirmadas cuya salida ya pasó (cron diario). */
export async function completarEstadias(cliente?: Consulta): Promise<number> {
  const { rowCount } = await db(cliente).query("UPDATE reservas.reservas SET estado = 'completada' WHERE estado = 'confirmada' AND fecha_salida < current_date");
  return rowCount ?? 0;
}

export async function resumenPagosAdmin(sesion: SesionActiva, cliente?: Consulta) {
  exigirFinanzas(sesion);
  const conexion = db(cliente);
  const pagos = (await conexion.query<{ id: string; estado: string; proveedor_codigo: string; metodo: string; monto_centavos: string; moneda_codigo: string; creado_en: Date; codigo: string; hotel: string }>(
    `SELECT p.id, p.estado, p.proveedor_codigo, p.metodo, p.monto_centavos, p.moneda_codigo, p.creado_en, r.codigo, h.nombre AS hotel
     FROM pagos.pagos p JOIN reservas.reservas r ON r.id = p.reserva_id JOIN catalogo.hoteles h ON h.id = r.hotel_id
     ORDER BY p.creado_en DESC LIMIT 100`,
  )).rows;
  const saldos = (await conexion.query<{ cuenta: string; moneda_codigo: string; saldo: string }>(
    "SELECT cuenta, moneda_codigo, sum(monto_centavos) AS saldo FROM pagos.asientos GROUP BY cuenta, moneda_codigo ORDER BY cuenta",
  )).rows;
  const liquidaciones = (await conexion.query<{ id: string; hotel: string; estado: string; periodo_desde: string; periodo_hasta: string; moneda_codigo: string; total: string; referencia_transferencia: string | null }>(
    `SELECT l.id, h.nombre AS hotel, l.estado, l.periodo_desde::text, l.periodo_hasta::text, l.moneda_codigo,
       (SELECT coalesce(sum(monto_centavos), 0) FROM pagos.liquidacion_lineas ll WHERE ll.liquidacion_id = l.id) AS total, l.referencia_transferencia
     FROM pagos.liquidaciones l JOIN catalogo.hoteles h ON h.id = l.hotel_id ORDER BY l.creado_en DESC LIMIT 50`,
  )).rows;
  const reembolsosPendientes = (await conexion.query<{ id: string; monto_centavos: string; motivo: string; proveedor_codigo: string; codigo: string }>(
    `SELECT re.id, re.monto_centavos, re.motivo, p.proveedor_codigo, r.codigo FROM pagos.reembolsos re
     JOIN pagos.pagos p ON p.id = re.pago_id JOIN reservas.reservas r ON r.id = p.reserva_id WHERE re.estado = 'pendiente'`,
  )).rows;
  return { pagos, saldos, liquidaciones, reembolsosPendientes };
}

/** Finanzas registra un reembolso hecho a mano en el portal del proveedor. */
export async function completarReembolsoManual(sesion: SesionActiva, reembolsoId: string, referencia: string, cliente?: Consulta): Promise<void> {
  exigirFinanzas(sesion);
  await enTransaccion(async (tx) => {
    const fila = (await tx.query<{ pago_id: string; monto_centavos: string }>(
      "UPDATE pagos.reembolsos SET estado = 'completado', referencia_externa = $2, completado_en = now(), solicitado_por = coalesce(solicitado_por, $3) WHERE id = $1 AND estado = 'pendiente' RETURNING pago_id, monto_centavos",
      [reembolsoId, referencia.trim(), sesion.usuario.id],
    )).rows[0];
    if (!fila) throw new ErrorNegocio("ESTADO_INVALIDO", "El reembolso no está pendiente.", { estado: 409 });
    const pago = (await tx.query<{ monto_centavos: string }>("SELECT monto_centavos FROM pagos.pagos WHERE id = $1", [fila.pago_id])).rows[0];
    await tx.query("UPDATE pagos.pagos SET estado = $2 WHERE id = $1", [fila.pago_id, fila.monto_centavos === pago.monto_centavos ? "reembolsado" : "reembolsado_parcial"]);
    await registrarEvento({ entidad: "reembolso", entidadId: reembolsoId, accion: "completado_manual", actor: { tipo: "usuario", usuarioId: sesion.usuario.id }, despues: { referencia } }, tx);
  }, cliente);
}
