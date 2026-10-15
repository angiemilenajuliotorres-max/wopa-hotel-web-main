import { generarAlertas, invitarAResenar } from "@wopa/servicios";

/** Revisión diaria de supervisión (Vercel Cron): crea alertas para WOPA. */
export async function GET(request: Request) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || request.headers.get("authorization") !== `Bearer ${secreto}`) {
    return Response.json({ error: { code: "NO_AUTORIZADO" } }, { status: 401 });
  }
  const alertas = await generarAlertas();
  const invitacionesResena = await invitarAResenar(process.env.URL_PUBLICA ?? "http://localhost:3100");
  return Response.json({ alertas, invitacionesResena });
}
