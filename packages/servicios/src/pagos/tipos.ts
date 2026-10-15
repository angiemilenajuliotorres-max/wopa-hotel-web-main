/**
 * Contrato común de las pasarelas de pago (ADR-006). Cada proveedor es un adaptador;
 * el enrutador elige cuál usar según país, moneda y método. Ver docs/arquitectura/04-precios-y-pagos.md.
 */

export type MetodoPago = "tarjeta" | "billetera" | "transferencia" | "efectivo";
export type EstadoPago = "pendiente" | "autorizado" | "capturado" | "fallido" | "cancelado" | "reembolsado_parcial" | "reembolsado";

export interface Dinero {
  centavos: bigint;
  moneda: string; // ISO 4217
}

export interface IntencionPago {
  pagoId: string;
  reservaCodigo: string;
  monto: Dinero;
  metodo: MetodoPago;
  descripcion: string;
  comprador: { nombre: string; correo: string; paisCodigo?: string | null };
  idioma: "es" | "en";
  urlRetorno: string;
  urlNotificacion: string;
  claveIdempotencia: string;
}

export type ResultadoCreacion =
  | { tipo: "redireccion"; url: string; referenciaExterna: string }
  | { tipo: "formulario"; datos: Record<string, string>; referenciaExterna: string }
  | { tipo: "qr"; contenido: string; expiraEn: Date; referenciaExterna: string };

/** Notificación ya verificada y traducida al vocabulario común. */
export interface EventoPago {
  eventoId: string; // único por proveedor: garantiza la idempotencia
  referenciaExterna: string;
  estado: EstadoPago;
  monto?: Dinero; // si el proveedor lo informa, se compara con el esperado
  crudo: unknown;
}

export interface NotificacionEntrante {
  metodo: string;
  cabeceras: Record<string, string>;
  consulta: Record<string, string>;
  cuerpo: string;
}

export interface ProveedorPago {
  readonly codigo: string;
  readonly metodos: MetodoPago[];
  readonly monedas: string[];
  /** false si faltan credenciales o el adaptador no fue verificado contra el sandbox oficial. */
  disponible(): boolean;
  crearPago(intencion: IntencionPago): Promise<ResultadoCreacion>;
  /** Estado actual consultado al proveedor (conciliación). null si el proveedor no ofrece consulta. */
  consultarPago(referenciaExterna: string): Promise<EstadoPago | null>;
  reembolsar(referenciaExterna: string, monto: Dinero, motivo: string): Promise<{ referencia: string }>;
  /** Lanza ErrorFirmaInvalida si la notificación no es auténtica. */
  verificarNotificacion(notificacion: NotificacionEntrante): Promise<EventoPago>;
}

export class ErrorFirmaInvalida extends Error {
  constructor(proveedor: string) {
    super(`Notificación de ${proveedor} con firma inválida.`);
    this.name = "ErrorFirmaInvalida";
  }
}

export class ErrorProveedor extends Error {
  readonly proveedor: string;
  constructor(proveedor: string, mensaje: string) {
    super(`${proveedor}: ${mensaje}`);
    this.name = "ErrorProveedor";
    this.proveedor = proveedor;
  }
}
