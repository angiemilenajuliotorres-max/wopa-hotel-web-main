import { ErrorNegocio, procesarNotificacion, type NotificacionEntrante } from "@wopa/servicios";

/**
 * Notificaciones de las pasarelas (POST con cuerpo firmado o GET tipo IPN, como Yappy).
 * Responde 200 aunque el evento sea duplicado, para que el proveedor no reintente sin fin.
 */
async function atender(request: Request, proveedor: string): Promise<Response> {
  const url = new URL(request.url);
  const notificacion: NotificacionEntrante = {
    metodo: request.method,
    cabeceras: Object.fromEntries([...request.headers.entries()].map(([clave, valor]) => [clave.toLowerCase(), valor])),
    consulta: Object.fromEntries(url.searchParams.entries()),
    cuerpo: request.method === "POST" ? await request.text() : "",
  };
  try {
    const resultado = await procesarNotificacion(proveedor, notificacion);
    return Response.json({ ok: true, ...resultado });
  } catch (error) {
    if (error instanceof ErrorNegocio) return Response.json({ error: { code: error.codigo } }, { status: error.estado });
    console.error("Error al procesar la notificación de pago", proveedor, error);
    return Response.json({ error: { code: "ERROR_INTERNO" } }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: RouteContext<"/api/v1/pagos/webhooks/[proveedor]">) {
  return atender(request, (await params).proveedor);
}

export async function GET(request: Request, { params }: RouteContext<"/api/v1/pagos/webhooks/[proveedor]">) {
  return atender(request, (await params).proveedor);
}
