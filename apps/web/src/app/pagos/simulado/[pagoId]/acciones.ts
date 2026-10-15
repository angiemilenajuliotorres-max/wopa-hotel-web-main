"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { datosPagoSimulado, firmarSimulado, procesarNotificacion, proveedores } from "@wopa/servicios";

/** Simula al proveedor: envía una notificación firmada y vuelve a la URL de retorno, como haría un banco. */
export async function resolverPagoSimulado(formulario: FormData): Promise<void> {
  const pagoId = String(formulario.get("pagoId") ?? "");
  const aprobar = formulario.get("resultado") === "aprobar";
  const pago = await datosPagoSimulado(pagoId);
  if (!pago || !proveedores().get("simulado")?.disponible()) redirect("/");
  const cuerpo = JSON.stringify({
    eventoId: randomUUID(),
    referenciaExterna: pago.referencia_externa,
    estado: aprobar ? "capturado" : "fallido",
    montoCentavos: pago.monto_centavos,
    moneda: pago.moneda_codigo,
  });
  await procesarNotificacion("simulado", { metodo: "POST", cabeceras: { "x-firma-simulada": firmarSimulado(cuerpo) }, consulta: {}, cuerpo });
  redirect(`/${pago.idioma}/reservar/${pago.codigo}?pago=${pago.id}`);
}
