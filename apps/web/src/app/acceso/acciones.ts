"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  aceptarInvitacion,
  cerrarSesion,
  confirmarConfiguracion2fa,
  esWopa,
  iniciarSesion,
  obtenerSesion,
  verificarSegundoFactor,
} from "@wopa/servicios";
import { codigoDeError } from "@/lib/errores";
import { borrarTokenSesion, exigirMismoOrigen, guardarTokenSesion, ipCliente, leerTokenSesion } from "@/lib/sesion";

function texto(formulario: FormData, campo: string): string {
  const valor = formulario.get(campo);
  return typeof valor === "string" ? valor : "";
}

export async function entrar(formulario: FormData): Promise<void> {
  await exigirMismoOrigen();
  let destino: string;
  try {
    const { token } = await iniciarSesion({
      correo: texto(formulario, "correo"),
      clave: texto(formulario, "clave"),
      ip: await ipCliente(),
      agente: (await headers()).get("user-agent"),
    });
    await guardarTokenSesion(token);
    destino = "/acceso/2fa";
  } catch (error) {
    destino = `/acceso?error=${codigoDeError(error)}`;
  }
  redirect(destino);
}

async function destinoTrasAcceso(token: string): Promise<string> {
  const sesion = await obtenerSesion(token);
  return sesion && esWopa(sesion) ? "/admin" : "/extranet";
}

export async function confirmar2fa(formulario: FormData): Promise<void> {
  await exigirMismoOrigen();
  const token = await leerTokenSesion();
  if (!token) redirect("/acceso");
  let destino: string;
  try {
    await confirmarConfiguracion2fa(token, texto(formulario, "codigo"));
    destino = await destinoTrasAcceso(token);
  } catch (error) {
    destino = `/acceso/2fa?error=${codigoDeError(error)}`;
  }
  redirect(destino);
}

export async function verificar2fa(formulario: FormData): Promise<void> {
  await exigirMismoOrigen();
  const token = await leerTokenSesion();
  if (!token) redirect("/acceso");
  let destino: string;
  try {
    await verificarSegundoFactor(token, texto(formulario, "codigo"), await ipCliente());
    destino = await destinoTrasAcceso(token);
  } catch (error) {
    destino = `/acceso/2fa?error=${codigoDeError(error)}`;
  }
  redirect(destino);
}

export async function activarInvitacion(formulario: FormData): Promise<void> {
  await exigirMismoOrigen();
  const token = texto(formulario, "token");
  let destino: string;
  try {
    if (texto(formulario, "clave") !== texto(formulario, "clave2")) {
      destino = `/acceso/invitacion?token=${encodeURIComponent(token)}&error=CLAVES_DISTINTAS`;
    } else {
      await aceptarInvitacion({ token, nombre: texto(formulario, "nombre"), clave: texto(formulario, "clave") });
      destino = "/acceso?activada=1";
    }
  } catch (error) {
    destino = `/acceso/invitacion?token=${encodeURIComponent(token)}&error=${codigoDeError(error)}`;
  }
  redirect(destino);
}

export async function salir(): Promise<void> {
  await exigirMismoOrigen();
  const token = await leerTokenSesion();
  if (token) await cerrarSesion(token);
  await borrarTokenSesion();
  redirect("/acceso");
}
