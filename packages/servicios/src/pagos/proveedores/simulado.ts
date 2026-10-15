/**
 * Pasarela simulada para desarrollo y pruebas: el viajero aprueba o rechaza el pago en una
 * página propia (/pagos/simulado/:pagoId) y esa página envía una notificación firmada con HMAC,
 * igual que haría un proveedor real. Nunca está disponible en producción salvo PAGOS_SIMULADOS=1.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { ErrorFirmaInvalida, type Dinero, type MetodoPago, type EstadoPago, type EventoPago, type IntencionPago, type NotificacionEntrante, type ProveedorPago, type ResultadoCreacion } from "../tipos.ts";

function secreto(): string {
  return process.env.PAGOS_SIMULADOS_SECRETO ?? "secreto-de-desarrollo-no-usar-en-produccion";
}

export function firmarSimulado(cuerpo: string): string {
  return createHmac("sha256", secreto()).update(cuerpo).digest("hex");
}

export interface NotificacionSimulada {
  eventoId: string;
  referenciaExterna: string;
  estado: "capturado" | "fallido";
  montoCentavos: string;
  moneda: string;
}

export class ProveedorSimulado implements ProveedorPago {
  readonly codigo = "simulado";
  readonly metodos: MetodoPago[] = ["tarjeta", "billetera"];
  readonly monedas = ["USD", "COP"];
  private readonly urlBase: string;

  constructor(urlBase: string) {
    this.urlBase = urlBase.replace(/\/$/, "");
  }

  disponible(): boolean {
    return process.env.NODE_ENV !== "production" || process.env.PAGOS_SIMULADOS === "1";
  }

  async crearPago(intencion: IntencionPago): Promise<ResultadoCreacion> {
    const referenciaExterna = `sim_${intencion.pagoId}`;
    return { tipo: "redireccion", url: `${this.urlBase}/pagos/simulado/${intencion.pagoId}`, referenciaExterna };
  }

  async consultarPago(): Promise<EstadoPago | null> {
    return null;
  }

  async reembolsar(referenciaExterna: string, monto: Dinero): Promise<{ referencia: string }> {
    return { referencia: `sim_reembolso_${referenciaExterna}_${monto.centavos}` };
  }

  async verificarNotificacion(notificacion: NotificacionEntrante): Promise<EventoPago> {
    const recibida = Buffer.from(notificacion.cabeceras["x-firma-simulada"] ?? "", "hex");
    const esperada = Buffer.from(firmarSimulado(notificacion.cuerpo), "hex");
    if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) throw new ErrorFirmaInvalida(this.codigo);
    const datos = JSON.parse(notificacion.cuerpo) as NotificacionSimulada;
    return {
      eventoId: datos.eventoId,
      referenciaExterna: datos.referenciaExterna,
      estado: datos.estado,
      monto: { centavos: BigInt(datos.montoCentavos), moneda: datos.moneda },
      crudo: datos,
    };
  }
}
