/**
 * PagueloFacil · enlace de pago con tarjeta.
 *
 * PENDIENTE DE VERIFICAR con la documentación y el sandbox oficiales (ver docs/POR-REVISAR.md):
 * la URL base, el formato de la respuesta y cómo autenticar la confirmación del pago.
 * Mientras no esté verificado (PAGUELOFACIL_VERIFICADO=1), el adaptador no se ofrece en el checkout.
 *
 * Seguridad: la confirmación nunca se toma de los parámetros del retorno del navegador; se confirma
 * consultando la transacción al proveedor desde el servidor (consultarPago), con la referencia guardada.
 */
import {
  ErrorProveedor,
  type EstadoPago,
  type EventoPago,
  type IntencionPago,
  type MetodoPago,
  type NotificacionEntrante,
  type ProveedorPago,
  type ResultadoCreacion,
} from "../tipos.ts";

function configuracion(): { cclw: string; url: string; token: string } | null {
  const { PAGUELOFACIL_CCLW, PAGUELOFACIL_URL, PAGUELOFACIL_TOKEN } = process.env;
  if (!PAGUELOFACIL_CCLW || !PAGUELOFACIL_URL || !PAGUELOFACIL_TOKEN) return null;
  return { cclw: PAGUELOFACIL_CCLW, url: PAGUELOFACIL_URL.replace(/\/$/, ""), token: PAGUELOFACIL_TOKEN };
}

function aHex(texto: string): string {
  return Buffer.from(texto, "utf8").toString("hex");
}

export class ProveedorPagueloFacil implements ProveedorPago {
  readonly codigo = "paguelofacil";
  readonly metodos: MetodoPago[] = ["tarjeta"];
  readonly monedas = ["USD"];

  disponible(): boolean {
    return configuracion() !== null && process.env.PAGUELOFACIL_VERIFICADO === "1";
  }

  private exigirConfiguracion() {
    const config = configuracion();
    if (!config) throw new ErrorProveedor(this.codigo, "faltan PAGUELOFACIL_CCLW, PAGUELOFACIL_URL o PAGUELOFACIL_TOKEN.");
    return config;
  }

  async crearPago(intencion: IntencionPago): Promise<ResultadoCreacion> {
    const config = this.exigirConfiguracion();
    if (intencion.monto.moneda !== "USD") throw new ErrorProveedor(this.codigo, "solo cobra en USD.");
    const cuerpo = new URLSearchParams({
      CCLW: config.cclw,
      CMTN: (Number(intencion.monto.centavos) / 100).toFixed(2),
      CDSC: intencion.descripcion.slice(0, 150),
      RETURN_URL: aHex(intencion.urlRetorno),
      PF_CF: aHex(JSON.stringify([{ id: "pagoId", nameOrLabel: "pagoId", value: intencion.pagoId }])),
      EXPIRES_IN: "1800",
    });
    const respuesta = await fetch(`${config.url}/LinkDeamon.cfm`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: cuerpo,
    });
    if (!respuesta.ok) throw new ErrorProveedor(this.codigo, `crear el enlace respondió ${respuesta.status}.`);
    const datos = (await respuesta.json()) as { success?: boolean; data?: { url?: string; code?: string } };
    if (!datos.success || !datos.data?.url || !datos.data.code) throw new ErrorProveedor(this.codigo, "respuesta sin enlace de pago.");
    return { tipo: "redireccion", url: datos.data.url, referenciaExterna: datos.data.code };
  }

  async consultarPago(): Promise<EstadoPago | null> {
    // La consulta de transacciones se implementa al verificar la API con el sandbox (PENDIENTE).
    throw new ErrorProveedor(this.codigo, "consulta de transacciones pendiente de verificación con el sandbox.");
  }

  async reembolsar(): Promise<{ referencia: string }> {
    throw new ErrorProveedor(this.codigo, "reembolso automático pendiente de verificación; regístralo como reembolso manual.");
  }

  async verificarNotificacion(_notificacion: NotificacionEntrante): Promise<EventoPago> {
    // El retorno del navegador no es una fuente confiable: la conciliación consulta al proveedor.
    throw new ErrorProveedor(this.codigo, "las notificaciones se confirman por conciliación (consultarPago).");
  }
}
