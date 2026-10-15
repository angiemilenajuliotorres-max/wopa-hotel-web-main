import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { esWopa, obtenerSesion, type SesionActiva } from "@wopa/servicios";

export const COOKIE_SESION = "wopa_sesion";

export async function leerTokenSesion(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE_SESION)?.value;
}

export async function guardarTokenSesion(token: string): Promise<void> {
  (await cookies()).set(COOKIE_SESION, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
}

export async function borrarTokenSesion(): Promise<void> {
  (await cookies()).delete(COOKIE_SESION);
}

export async function ipCliente(): Promise<string | null> {
  const cabeceras = await headers();
  return cabeceras.get("x-forwarded-for")?.split(",")[0]?.trim() ?? cabeceras.get("x-real-ip") ?? null;
}

/** Sesión con la verificación en dos pasos completa, o redirige al acceso. */
export async function exigirSesion(): Promise<SesionActiva> {
  const sesion = await obtenerSesion(await leerTokenSesion());
  if (!sesion) redirect("/acceso");
  if (!sesion.segundoFactorOk) redirect("/acceso/2fa");
  return sesion;
}

export async function exigirWopa(): Promise<SesionActiva> {
  const sesion = await exigirSesion();
  if (!esWopa(sesion)) redirect("/extranet");
  return sesion;
}

/** Comprueba que una petición POST venga de nuestro propio sitio (defensa CSRF adicional a SameSite). */
export async function exigirMismoOrigen(): Promise<void> {
  const cabeceras = await headers();
  const origen = cabeceras.get("origin");
  const host = cabeceras.get("x-forwarded-host") ?? cabeceras.get("host");
  if (origen && host && new URL(origen).host !== host) throw new Error("Origen no permitido.");
}
