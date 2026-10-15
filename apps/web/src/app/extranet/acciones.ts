"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  aceptarSolicitud,
  cargarCupos,
  cargarTarifaNeta,
  crearTicket,
  marcarSaldoCobrado,
  proponerCambioContenido,
  rechazarSolicitud,
} from "@wopa/servicios";
import { codigoDeError } from "@/lib/errores";
import { aCentavos } from "@/lib/formato";
import { exigirMismoOrigen, exigirSesion } from "@/lib/sesion";

function texto(formulario: FormData, campo: string): string {
  const valor = formulario.get(campo);
  return typeof valor === "string" ? valor.trim() : "";
}

async function ejecutar(volverA: string, trabajo: () => Promise<void>): Promise<never> {
  await exigirMismoOrigen();
  let destino: string;
  try {
    await trabajo();
    revalidatePath("/extranet", "layout");
    destino = `${volverA}${volverA.includes("?") ? "&" : "?"}ok=1`;
  } catch (error) {
    destino = `${volverA}${volverA.includes("?") ? "&" : "?"}error=${error instanceof Error && error.message === "Monto inválido" ? "DATOS_INVALIDOS" : codigoDeError(error)}`;
  }
  redirect(destino);
}

const volver = (formulario: FormData) => `/extranet/hoteles/${texto(formulario, "hotelId")}`;

export async function tarifaExtranet(formulario: FormData): Promise<void> {
  await ejecutar(volver(formulario), async () => {
    await cargarTarifaNeta(await exigirSesion(), {
      hotelId: texto(formulario, "hotelId"),
      planTarifaId: texto(formulario, "planTarifaId"),
      tipoHabitacionId: texto(formulario, "tipoHabitacionId"),
      desde: texto(formulario, "desde"),
      hasta: texto(formulario, "hasta"),
      ocupacion: Number(texto(formulario, "ocupacion")),
      netoCentavos: aCentavos(texto(formulario, "neto")),
      estanciaMinima: Number(texto(formulario, "estanciaMinima") || "1"),
    });
  });
}

export async function cuposExtranet(formulario: FormData): Promise<void> {
  await ejecutar(volver(formulario), async () => {
    const cupo = texto(formulario, "cupoTotal");
    await cargarCupos(await exigirSesion(), {
      hotelId: texto(formulario, "hotelId"),
      tipoHabitacionId: texto(formulario, "tipoHabitacionId"),
      desde: texto(formulario, "desde"),
      hasta: texto(formulario, "hasta"),
      cupoTotal: cupo === "" ? undefined : Number(cupo),
      cerrado: formulario.get("cerrado") === "on",
    });
  });
}

export async function descripcionExtranet(formulario: FormData): Promise<void> {
  await ejecutar(volver(formulario), async () => {
    await proponerCambioContenido(await exigirSesion(), texto(formulario, "hotelId"), {
      idioma: texto(formulario, "idioma") === "en" ? "en" : "es",
      descripcion: texto(formulario, "descripcion"),
      comoLlegar: texto(formulario, "comoLlegar") || null,
    });
  });
}

export async function solicitudExtranet(formulario: FormData): Promise<void> {
  await ejecutar(volver(formulario), async () => {
    const sesion = await exigirSesion();
    const reservaId = texto(formulario, "reservaId");
    if (texto(formulario, "accion") === "aceptar") await aceptarSolicitud(sesion, reservaId, process.env.URL_PUBLICA ?? "http://localhost:3100");
    else await rechazarSolicitud(sesion, reservaId, "Sin disponibilidad (hotel)");
  });
}

export async function saldoCobradoExtranet(formulario: FormData): Promise<void> {
  await ejecutar(volver(formulario), async () => {
    await marcarSaldoCobrado(await exigirSesion(), texto(formulario, "reservaId"));
  });
}

export async function ticketExtranet(formulario: FormData): Promise<void> {
  await ejecutar(volver(formulario), async () => {
    const sesion = await exigirSesion();
    await crearTicket({
      categoria: "cuenta_hotel",
      asunto: texto(formulario, "asunto"),
      mensaje: `${texto(formulario, "mensaje")}\n\n(Hotel: ${texto(formulario, "hotelNombre")})`,
      nombre: sesion.usuario.nombre,
      correo: sesion.usuario.correo,
      idioma: "es",
      origen: "extranet",
    });
  });
}
