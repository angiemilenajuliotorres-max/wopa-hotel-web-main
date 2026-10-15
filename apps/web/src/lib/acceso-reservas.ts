import "server-only";
import { cookies } from "next/headers";

/**
 * Acceso a "Mi reserva" sin cuenta: el código + el correo del titular son la credencial.
 * Se guardan en una cookie HttpOnly para no ponerlos en la URL (evita filtrar el correo).
 */
const COOKIE = "wopa_reservas";

export async function reservasConAcceso(): Promise<Record<string, string>> {
  try {
    const valor = (await cookies()).get(COOKIE)?.value;
    const datos = valor ? JSON.parse(valor) : {};
    return typeof datos === "object" && datos !== null ? (datos as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export async function darAccesoReserva(codigo: string, correo: string): Promise<void> {
  const actuales = await reservasConAcceso();
  const entradas = Object.entries({ ...actuales, [codigo.toUpperCase()]: correo.toLowerCase() }).slice(-10);
  (await cookies()).set(COOKIE, JSON.stringify(Object.fromEntries(entradas)), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 60,
  });
}
