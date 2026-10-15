import { randomBytes } from "node:crypto";
import { crearAdministradorWopa } from "@wopa/db";
import type { BaseDePrueba } from "@wopa/db/pruebas";
import { codigoTotp } from "@wopa/dominio/identidad";
import {
  confirmarConfiguracion2fa,
  iniciarConfiguracion2fa,
  iniciarSesion,
  obtenerSesion,
  type SesionActiva,
} from "../src/identidad.ts";

process.env.SECRETO_CIFRADO ??= randomBytes(32).toString("base64");
export const CLAVE_PRUEBA = "clave de prueba muy segura";

/** Fecha YYYY-MM-DD a `dias` de hoy (UTC). */
export function fecha(dias: number): string {
  return new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);
}

/** Crea un administrador de WOPA con la 2FA configurada y devuelve su sesión activa. */
export async function sesionWopa(db: BaseDePrueba, correo = "ops@wopa.test"): Promise<SesionActiva> {
  await crearAdministradorWopa(db, { correo, nombre: "Operaciones WOPA", clave: CLAVE_PRUEBA });
  const { token } = await iniciarSesion({ correo, clave: CLAVE_PRUEBA }, db);
  const { secreto } = await iniciarConfiguracion2fa(token, db);
  await confirmarConfiguracion2fa(token, codigoTotp(secreto), db);
  return (await obtenerSesion(token, db))!;
}

export async function idCiudad(db: BaseDePrueba, slug: string): Promise<string> {
  return (await db.query<{ id: string }>("SELECT ciudad_id AS id FROM geo.ciudad_traducciones WHERE slug = $1 AND idioma_codigo = 'es'", [slug])).rows[0].id;
}

export async function idPlanBase(db: BaseDePrueba, hotelId: string): Promise<string> {
  return (await db.query<{ id: string }>("SELECT id FROM tarifas.planes_tarifa WHERE hotel_id = $1 AND codigo = 'base'", [hotelId])).rows[0].id;
}
