import { NextResponse, type NextRequest } from "next/server";

const IDIOMAS = ["es", "en"] as const;

/** Elige el idioma del navegador solo para la portada sin prefijo; nunca fuerza un cambio después. */
function idiomaPreferido(request: NextRequest): (typeof IDIOMAS)[number] {
  const guardado = request.cookies.get("idioma")?.value;
  if (guardado === "es" || guardado === "en") return guardado;
  const aceptados = request.headers.get("accept-language") ?? "";
  const primero = aceptados.split(",")[0]?.trim().slice(0, 2).toLowerCase();
  return primero === "en" ? "en" : "es";
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/") {
    return NextResponse.redirect(new URL(`/${idiomaPreferido(request)}`, request.url));
  }
  // Guarda el idioma elegido cuando el usuario navega en /es o /en.
  const segmento = pathname.split("/")[1];
  if (segmento === "es" || segmento === "en") {
    const respuesta = NextResponse.next();
    if (request.cookies.get("idioma")?.value !== segmento) {
      respuesta.cookies.set("idioma", segmento, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    }
    return respuesta;
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/es/:path*", "/en/:path*"],
};
