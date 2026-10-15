import { enviarMensaje, ErrorNegocio, iniciarConversacion, valorarConversacion } from "@wopa/servicios";

function ipDe(request: Request): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? null;
}

/** Chat del asistente. Cuerpo: { conversacionId?, texto, idioma } o { conversacionId, valoracion }. */
export async function POST(request: Request) {
  const origen = request.headers.get("origin");
  if (origen && new URL(origen).host !== new URL(request.url).host) {
    return Response.json({ error: { code: "ORIGEN_NO_PERMITIDO" } }, { status: 403 });
  }
  let cuerpo: { conversacionId?: string; texto?: string; idioma?: string; valoracion?: number };
  try {
    cuerpo = await request.json();
  } catch {
    return Response.json({ error: { code: "DATOS_INVALIDOS" } }, { status: 400 });
  }
  const idioma = cuerpo.idioma === "en" ? "en" : "es";
  const ip = ipDe(request);
  try {
    if (cuerpo.valoracion !== undefined && cuerpo.conversacionId) {
      await valorarConversacion(cuerpo.conversacionId, Number(cuerpo.valoracion));
      return Response.json({ ok: true });
    }
    const conversacionId = cuerpo.conversacionId && /^[0-9a-f-]{36}$/.test(cuerpo.conversacionId) ? cuerpo.conversacionId : await iniciarConversacion({ idioma, ip });
    const resultado = await enviarMensaje({ conversacionId, texto: String(cuerpo.texto ?? ""), ip });
    return Response.json({ conversacionId, ...resultado });
  } catch (error) {
    if (error instanceof ErrorNegocio) return Response.json({ error: { code: error.codigo, message: error.message } }, { status: error.estado });
    console.error("Error en el chat del asistente", error);
    return Response.json({ error: { code: "ERROR_INTERNO" } }, { status: 500 });
  }
}
