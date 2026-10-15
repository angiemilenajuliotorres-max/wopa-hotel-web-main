/**
 * Wompi (Bancolombia) · Colombia, en pesos (COP): tarjeta, PSE y Nequi con el Web Checkout.
 *
 * Esquema público de Wompi (docs.wompi.co), implementado:
 * - Web Checkout: https://checkout.wompi.co/p/ con public-key, currency, amount-in-cents, reference,
 *   redirect-url y signature:integrity = SHA256(reference + amount-in-cents + currency + secreto de integridad).
 * - Eventos (webhook): checksum = SHA256(valores de signature.properties en orden + timestamp + secreto de eventos),
 *   comparado con signature.checksum. Estados de transacción: APPROVED, DECLINED, VOIDED, ERROR, PENDING.
 * - Consulta: GET {api}/transactions?reference=… con la llave privada.
 *
 * PENDIENTE DE VERIFICAR en el sandbox de Wompi (ver docs/POR-REVISAR.md). Requiere cuenta en Colombia.
 * Solo se ofrece con WOMPI_VERIFICADO=1.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import {
  ErrorFirmaInvalida,
  ErrorProveedor,
  type EstadoPago,
  type EventoPago,
  type IntencionPago,
  type MetodoPago,
  type NotificacionEntrante,
  type ProveedorPago,
  type ResultadoCreacion,
} from "../tipos.ts";

interface ConfiguracionWompi {
  llavePublica: string;
  llavePrivada: string;
  secretoIntegridad: string;
  secretoEventos: string;
  urlApi: string; // https://sandbox.wompi.co/v1 o https://production.wompi.co/v1
}

function configuracion(): ConfiguracionWompi | null {
  const { WOMPI_LLAVE_PUBLICA, WOMPI_LLAVE_PRIVADA, WOMPI_SECRETO_INTEGRIDAD, WOMPI_SECRETO_EVENTOS, WOMPI_URL_API } = process.env;
  if (!WOMPI_LLAVE_PUBLICA || !WOMPI_LLAVE_PRIVADA || !WOMPI_SECRETO_INTEGRIDAD || !WOMPI_SECRETO_EVENTOS || !WOMPI_URL_API) return null;
  return { llavePublica: WOMPI_LLAVE_PUBLICA, llavePrivada: WOMPI_LLAVE_PRIVADA, secretoIntegridad: WOMPI_SECRETO_INTEGRIDAD, secretoEventos: WOMPI_SECRETO_EVENTOS, urlApi: WOMPI_URL_API.replace(/\/$/, "") };
}

const sha256 = (texto: string) => createHash("sha256").update(texto).digest("hex");

export function firmaIntegridadWompi(referencia: string, montoCentavos: bigint, moneda: string, secretoIntegridad: string): string {
  return sha256(`${referencia}${montoCentavos}${moneda}${secretoIntegridad}`);
}

/** Lee una ruta tipo "transaction.status" dentro de data. */
function valorEn(objeto: unknown, ruta: string): string {
  return String(ruta.split(".").reduce<unknown>((actual, clave) => (actual && typeof actual === "object" ? (actual as Record<string, unknown>)[clave] : undefined), objeto) ?? "");
}

export function checksumEventoWompi(evento: { data: unknown; signature: { properties: string[] }; timestamp: number | string }, secretoEventos: string): string {
  return sha256(`${evento.signature.properties.map((p) => valorEn(evento.data, p)).join("")}${evento.timestamp}${secretoEventos}`);
}

const ESTADOS: Record<string, EstadoPago> = { APPROVED: "capturado", DECLINED: "fallido", VOIDED: "cancelado", ERROR: "fallido", PENDING: "pendiente" };

export class ProveedorWompi implements ProveedorPago {
  readonly codigo = "wompi";
  readonly metodos: MetodoPago[] = ["tarjeta", "transferencia", "billetera"];
  readonly monedas = ["COP"];

  disponible(): boolean {
    return configuracion() !== null && process.env.WOMPI_VERIFICADO === "1";
  }

  private exigirConfiguracion(): ConfiguracionWompi {
    const config = configuracion();
    if (!config) throw new ErrorProveedor(this.codigo, "faltan las llaves de Wompi.");
    return config;
  }

  async crearPago(intencion: IntencionPago): Promise<ResultadoCreacion> {
    const config = this.exigirConfiguracion();
    if (intencion.monto.moneda !== "COP") throw new ErrorProveedor(this.codigo, "solo cobra en COP.");
    const referencia = intencion.pagoId;
    const parametros = new URLSearchParams({
      "public-key": config.llavePublica,
      currency: "COP",
      "amount-in-cents": intencion.monto.centavos.toString(),
      reference: referencia,
      "signature:integrity": firmaIntegridadWompi(referencia, intencion.monto.centavos, "COP", config.secretoIntegridad),
      "redirect-url": intencion.urlRetorno,
      "customer-data:email": intencion.comprador.correo,
      "customer-data:full-name": intencion.comprador.nombre,
    });
    return { tipo: "redireccion", url: `https://checkout.wompi.co/p/?${parametros}`, referenciaExterna: referencia };
  }

  async consultarPago(referenciaExterna: string): Promise<EstadoPago | null> {
    const config = this.exigirConfiguracion();
    const respuesta = await fetch(`${config.urlApi}/transactions?reference=${encodeURIComponent(referenciaExterna)}`, {
      headers: { authorization: `Bearer ${config.llavePrivada}` },
    });
    if (!respuesta.ok) throw new ErrorProveedor(this.codigo, `consulta respondió ${respuesta.status}.`);
    const transacciones = ((await respuesta.json()) as { data?: { status?: string }[] }).data ?? [];
    const estado = transacciones.map((t) => ESTADOS[t.status ?? ""]).find((e) => e && e !== "pendiente");
    return estado ?? "pendiente";
  }

  async reembolsar(): Promise<{ referencia: string }> {
    throw new ErrorProveedor(this.codigo, "los reembolsos se hacen desde el panel de comercios de Wompi; regístralo como reembolso manual.");
  }

  async verificarNotificacion(notificacion: NotificacionEntrante): Promise<EventoPago> {
    const config = this.exigirConfiguracion();
    let evento: { event?: string; data?: { transaction?: { id: string; reference: string; status: string; amount_in_cents: number; currency: string } }; signature?: { properties: string[]; checksum: string }; timestamp?: number };
    try {
      evento = JSON.parse(notificacion.cuerpo);
    } catch {
      throw new ErrorFirmaInvalida(this.codigo);
    }
    const transaccion = evento.data?.transaction;
    if (!evento.signature || !transaccion || evento.timestamp === undefined) throw new ErrorFirmaInvalida(this.codigo);
    const esperado = Buffer.from(checksumEventoWompi({ data: evento.data, signature: evento.signature, timestamp: evento.timestamp }, config.secretoEventos));
    const recibido = Buffer.from(String(evento.signature.checksum).toLowerCase());
    if (esperado.length !== recibido.length || !timingSafeEqual(esperado, recibido)) throw new ErrorFirmaInvalida(this.codigo);
    return {
      eventoId: `${transaccion.id}:${transaccion.status}`,
      referenciaExterna: transaccion.reference,
      estado: ESTADOS[transaccion.status] ?? "pendiente",
      monto: { centavos: BigInt(transaccion.amount_in_cents), moneda: transaccion.currency },
      crudo: evento,
    };
  }
}
