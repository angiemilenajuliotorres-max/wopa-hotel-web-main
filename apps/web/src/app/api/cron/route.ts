import { completarEstadias, conciliarPendientes, expirarRetenciones, procesarCorreosPendientes } from "@wopa/servicios";

/**
 * Tareas periódicas (Vercel Cron, cada minuto): expira retenciones vencidas y envía la cola de correos.
 * Vercel envía "Authorization: Bearer <CRON_SECRET>".
 */
export async function GET(request: Request) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || request.headers.get("authorization") !== `Bearer ${secreto}`) {
    return Response.json({ error: { code: "NO_AUTORIZADO" } }, { status: 401 });
  }
  const expiradas = await expirarRetenciones();
  const conciliacion = await conciliarPendientes();
  const completadas = await completarEstadias();
  const correos = await procesarCorreosPendientes();
  return Response.json({ expiradas, conciliacion, completadas, correos });
}
