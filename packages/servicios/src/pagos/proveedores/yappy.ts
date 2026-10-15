/**
 * Yappy Comercial (Banco General) · Botón de Pago, integración nueva.
 *
 * Confirmado en la documentación oficial (yappy.com.pa/comercial/desarrolladores):
 * - Dos llamadas desde el backend: validación del comercio (`payments/validate/merchant`, con merchantId y dominio)
 *   y creación de la orden (orderId alfanumérico de 1 a 15 caracteres, domain, paymentDate, ipnUrl, montos).
 * - Notificación IPN por GET con orderId, Hash y status: E (ejecutado), R (rechazado), C (cancelado).
 *
 * PENDIENTE DE VERIFICAR en el entorno UAT con credenciales (ver docs/POR-REVISAR.md):
 * - URL base de la API (se configura por variable, no se asume).
 * - Algoritmo del Hash del IPN: se implementa HMAC-SHA256 sobre orderId + status + domain con la clave secreta,
 *   como en implementaciones de terceros; la documentación oficial no lo detalla.
 * - Forma exacta de las respuestas y la unidad de paymentDate.
 * Por eso el adaptador solo está disponible con YAPPY_VERIFICADO=1.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
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

interface ConfiguracionYappy {
  merchantId: string;
  claveSecreta: string;
  urlApi: string;
  dominio: string;
}

function configuracion(): ConfiguracionYappy | null {
  const { YAPPY_MERCHANT_ID, YAPPY_CLAVE_SECRETA, YAPPY_URL_API, YAPPY_DOMINIO } = process.env;
  if (!YAPPY_MERCHANT_ID || !YAPPY_CLAVE_SECRETA || !YAPPY_URL_API || !YAPPY_DOMINIO) return null;
  return { merchantId: YAPPY_MERCHANT_ID, claveSecreta: YAPPY_CLAVE_SECRETA, urlApi: YAPPY_URL_API.replace(/\/$/, ""), dominio: YAPPY_DOMINIO };
}

/** orderId de Yappy: alfanumérico, máximo 15 caracteres. Se deriva del id del pago (uuidv7, único). */
export function ordenYappy(pagoId: string): string {
  return pagoId.replace(/-/g, "").slice(-15).toUpperCase();
}

export function hashIpnYappy(claveSecreta: string, orderId: string, status: string, domain: string): string {
  return createHmac("sha256", claveSecreta).update(`${orderId}${status}${domain}`).digest("hex");
}

const ESTADOS: Record<string, EstadoPago> = { E: "capturado", R: "fallido", C: "cancelado" };

export class ProveedorYappy implements ProveedorPago {
  readonly codigo = "yappy";
  readonly metodos: MetodoPago[] = ["billetera"];
  readonly monedas = ["USD"];

  disponible(): boolean {
    return configuracion() !== null && process.env.YAPPY_VERIFICADO === "1";
  }

  private exigirConfiguracion(): ConfiguracionYappy {
    const config = configuracion();
    if (!config) throw new ErrorProveedor(this.codigo, "faltan YAPPY_MERCHANT_ID, YAPPY_CLAVE_SECRETA, YAPPY_URL_API o YAPPY_DOMINIO.");
    return config;
  }

  async crearPago(intencion: IntencionPago): Promise<ResultadoCreacion> {
    const config = this.exigirConfiguracion();
    if (intencion.monto.moneda !== "USD") throw new ErrorProveedor(this.codigo, "solo cobra en USD.");
    const orderId = ordenYappy(intencion.pagoId);

    const validacion = await fetch(`${config.urlApi}/payments/validate/merchant`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ merchantId: config.merchantId, urlDomain: config.dominio }),
    });
    if (!validacion.ok) throw new ErrorProveedor(this.codigo, `validación del comercio respondió ${validacion.status}.`);
    const token = ((await validacion.json()) as { body?: { token?: string } }).body?.token;
    if (!token) throw new ErrorProveedor(this.codigo, "la validación no devolvió token.");

    const total = (Number(intencion.monto.centavos) / 100).toFixed(2);
    const orden = await fetch(`${config.urlApi}/payments/payment-wc`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: token },
      body: JSON.stringify({
        merchantId: config.merchantId,
        orderId,
        domain: config.dominio,
        paymentDate: Math.floor(Date.now() / 1000),
        ipnUrl: intencion.urlNotificacion,
        discount: "0.00",
        taxes: "0.00",
        subtotal: total,
        total,
      }),
    });
    if (!orden.ok) throw new ErrorProveedor(this.codigo, `crear la orden respondió ${orden.status}.`);
    const datos = ((await orden.json()) as { body?: Record<string, string> }).body ?? {};
    // El botón web de Yappy (componente de su CDN) usa estos datos en el navegador para abrir el pago.
    return { tipo: "formulario", datos, referenciaExterna: orderId };
  }

  async consultarPago(): Promise<EstadoPago | null> {
    return null; // Yappy notifica por IPN; no se usa consulta de estado.
  }

  async reembolsar(): Promise<{ referencia: string }> {
    throw new ErrorProveedor(this.codigo, "los reembolsos se hacen desde Yappy Comercial; regístralo como reembolso manual.");
  }

  async verificarNotificacion(notificacion: NotificacionEntrante): Promise<EventoPago> {
    const config = this.exigirConfiguracion();
    const { orderId = "", status = "", domain = config.dominio } = notificacion.consulta;
    const hash = notificacion.consulta.hash ?? notificacion.consulta.Hash ?? "";
    const esperado = Buffer.from(hashIpnYappy(config.claveSecreta, orderId, status, domain));
    const recibido = Buffer.from(hash);
    if (!orderId || !ESTADOS[status] || esperado.length !== recibido.length || !timingSafeEqual(esperado, recibido)) {
      throw new ErrorFirmaInvalida(this.codigo);
    }
    return { eventoId: `${orderId}:${status}`, referenciaExterna: orderId, estado: ESTADOS[status], crudo: notificacion.consulta };
  }
}
