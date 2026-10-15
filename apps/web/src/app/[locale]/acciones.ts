"use server";

import { redirect } from "next/navigation";
import { cancelarPorViajero, consultarReserva, crearReserva, crearTicket, ErrorNegocio, type Categoria } from "@wopa/servicios";
import { darAccesoReserva, reservasConAcceso } from "@/lib/acceso-reservas";
import { esIdioma, type Idioma } from "@/lib/formato";
import { exigirMismoOrigen } from "@/lib/sesion";

function texto(formulario: FormData, campo: string): string {
  const valor = formulario.get(campo);
  return typeof valor === "string" ? valor.trim() : "";
}

function idiomaDe(formulario: FormData): Idioma {
  const valor = texto(formulario, "idioma");
  return esIdioma(valor) ? valor : "es";
}

function codigoDe(error: unknown): string {
  if (error instanceof ErrorNegocio) return error.codigo;
  console.error(error);
  return "ERROR_INESPERADO";
}

export async function crearReservaAccion(formulario: FormData): Promise<void> {
  await exigirMismoOrigen();
  const idioma = idiomaDe(formulario);
  const datos = {
    hotelSlug: texto(formulario, "hotel"),
    tipoHabitacionId: texto(formulario, "habitacion"),
    planTarifaId: texto(formulario, "plan"),
    entrada: texto(formulario, "entrada"),
    salida: texto(formulario, "salida"),
    huespedes: Number(texto(formulario, "huespedes")),
  };
  let destino: string;
  try {
    const correo = texto(formulario, "correo");
    const reserva = await crearReserva({
      ...datos,
      idioma,
      titular: { nombre: texto(formulario, "nombre"), correo, telefono: texto(formulario, "telefono"), paisCodigo: texto(formulario, "pais") || null },
      solicitudesEspeciales: texto(formulario, "solicitudes") || null,
    });
    await darAccesoReserva(reserva.codigo, correo);
    destino = `/${idioma}/reservar/${reserva.codigo}`;
  } catch (error) {
    const consulta = new URLSearchParams({
      hotel: datos.hotelSlug, habitacion: datos.tipoHabitacionId, plan: datos.planTarifaId,
      entrada: datos.entrada, salida: datos.salida, huespedes: String(datos.huespedes), error: codigoDe(error),
    });
    destino = `/${idioma}/reservar/nueva?${consulta}`;
  }
  redirect(destino);
}

export async function consultarReservaAccion(formulario: FormData): Promise<void> {
  await exigirMismoOrigen();
  const idioma = idiomaDe(formulario);
  const codigo = texto(formulario, "codigo").toUpperCase();
  const correo = texto(formulario, "correo");
  const reserva = codigo && correo ? await consultarReserva(codigo, correo) : null;
  if (!reserva) redirect(`/${idioma}/mi-reserva?error=RESERVA_NO_ENCONTRADA`);
  await darAccesoReserva(reserva.codigo, correo);
  redirect(`/${idioma}/reservar/${reserva.codigo}`);
}

export async function cancelarReservaAccion(formulario: FormData): Promise<void> {
  await exigirMismoOrigen();
  const idioma = idiomaDe(formulario);
  const codigo = texto(formulario, "codigo").toUpperCase();
  const correo = (await reservasConAcceso())[codigo];
  let destino: string;
  if (!correo) {
    destino = `/${idioma}/mi-reserva?error=RESERVA_NO_ENCONTRADA`;
  } else {
    try {
      const { reembolsoCentavos } = await cancelarPorViajero({ codigo, correo, motivo: texto(formulario, "motivo") || undefined });
      destino = `/${idioma}/reservar/${codigo}?cancelada=1&reembolso=${reembolsoCentavos}`;
    } catch (error) {
      destino = `/${idioma}/reservar/${codigo}?error=${codigoDe(error)}`;
    }
  }
  redirect(destino);
}

export async function crearTicketAccion(formulario: FormData): Promise<void> {
  await exigirMismoOrigen();
  const idioma = idiomaDe(formulario);
  const reservaCodigo = texto(formulario, "reserva").toUpperCase() || null;
  let destino: string;
  try {
    const { codigo } = await crearTicket({
      categoria: (texto(formulario, "categoria") || "otro") as Categoria,
      asunto: texto(formulario, "asunto"),
      mensaje: texto(formulario, "mensaje"),
      nombre: texto(formulario, "nombre"),
      correo: texto(formulario, "correo"),
      telefono: texto(formulario, "telefono") || null,
      idioma,
      origen: reservaCodigo ? "mi_reserva" : "contacto",
      reservaCodigo,
    });
    destino = `/${idioma}/ayuda?enviado=${codigo}`;
  } catch (error) {
    destino = `/${idioma}/ayuda?error=${codigoDe(error)}${reservaCodigo ? `&reserva=${reservaCodigo}` : ""}#contacto`;
  }
  redirect(destino);
}
