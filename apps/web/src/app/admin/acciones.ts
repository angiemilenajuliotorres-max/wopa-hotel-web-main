"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  moderarResena,
  resolverRevision,
  aprobarLiquidacion,
  completarReembolsoManual,
  generarLiquidacion,
  marcarLiquidacionPagada,
  aceptarHotel,
  aceptarSolicitud,
  rechazarSolicitud,
  responderTicket,
  ajustarMargen,
  atenderAlerta,
  cargarCupos,
  cargarTarifaNeta,
  crearHotel,
  crearTipoHabitacion,
  invitarUsuario,
  type ReglaMargenEntrada,
  type Rol,
} from "@wopa/servicios";
import { codigoDeError } from "@/lib/errores";
import { aCentavos } from "@/lib/formato";
import { exigirMismoOrigen, exigirWopa } from "@/lib/sesion";

function texto(formulario: FormData, campo: string): string {
  const valor = formulario.get(campo);
  return typeof valor === "string" ? valor.trim() : "";
}

function urlBase(): string {
  return process.env.URL_PUBLICA ?? "http://localhost:3100";
}

/** Margen del formulario: porcentaje sobre la neta o monto fijo por noche. */
function leerMargen(formulario: FormData): ReglaMargenEntrada {
  const valor = texto(formulario, "margenValor");
  if (texto(formulario, "margenTipo") === "monto_fijo") return { tipo: "monto_fijo", montoCentavos: aCentavos(valor) };
  const porcentaje = Number(valor.replace(",", "."));
  return { tipo: "porcentaje", porcentajeBp: Math.round(porcentaje * 100) };
}

async function ejecutar(volverA: string, trabajo: () => Promise<string | void>): Promise<never> {
  await exigirMismoOrigen();
  let destino: string;
  try {
    destino = (await trabajo()) ?? `${volverA}?ok=1`;
    revalidatePath("/admin", "layout");
  } catch (error) {
    destino = `${volverA}?error=${error instanceof Error && error.message === "Monto inválido" ? "DATOS_INVALIDOS" : codigoDeError(error)}`;
  }
  redirect(destino);
}

export async function crearHotelAccion(formulario: FormData): Promise<void> {
  await ejecutar("/admin/hoteles/nuevo", async () => {
    const sesion = await exigirWopa();
    const { hotelId } = await crearHotel(sesion, {
      nombre: texto(formulario, "nombre"),
      ciudadId: texto(formulario, "ciudadId"),
      monedaCodigo: texto(formulario, "moneda") || "USD",
      direccion: texto(formulario, "direccion"),
      latitud: Number(texto(formulario, "latitud")),
      longitud: Number(texto(formulario, "longitud")),
      categoria: texto(formulario, "categoria") ? Number(texto(formulario, "categoria")) : null,
      correoReservas: texto(formulario, "correoReservas") || null,
      telefono: texto(formulario, "telefono") || null,
      registroTurismo: texto(formulario, "registroTurismo") || null,
      modoReserva: texto(formulario, "modo") === "solicitud" ? "solicitud" : "anticipo_en_linea",
    });
    return `/admin/hoteles/${hotelId}?creado=1`;
  });
}

export async function aceptarHotelAccion(formulario: FormData): Promise<void> {
  const hotelId = texto(formulario, "hotelId");
  await ejecutar(`/admin/hoteles/${hotelId}`, async () => {
    await aceptarHotel(await exigirWopa(), { hotelId, margen: leerMargen(formulario), motivo: texto(formulario, "motivo") });
  });
}

export async function ajustarMargenAccion(formulario: FormData): Promise<void> {
  const hotelId = texto(formulario, "hotelId");
  await ejecutar(`/admin/hoteles/${hotelId}`, async () => {
    await ajustarMargen(await exigirWopa(), {
      hotelId,
      planTarifaId: texto(formulario, "planTarifaId") || null,
      regla: leerMargen(formulario),
      desde: texto(formulario, "desde"),
      hasta: texto(formulario, "hasta") || null,
      motivo: texto(formulario, "motivo"),
    });
  });
}

export async function crearHabitacionAccion(formulario: FormData): Promise<void> {
  const hotelId = texto(formulario, "hotelId");
  await ejecutar(`/admin/hoteles/${hotelId}`, async () => {
    await crearTipoHabitacion(await exigirWopa(), {
      hotelId,
      codigo: texto(formulario, "nombreEs"),
      capacidadMaxima: Number(texto(formulario, "capacidad")),
      nombre: { es: texto(formulario, "nombreEs"), en: texto(formulario, "nombreEn") || undefined },
      descripcion: { es: texto(formulario, "descripcionEs") || undefined, en: texto(formulario, "descripcionEn") || undefined },
    });
  });
}

export async function cargarTarifaAccion(formulario: FormData): Promise<void> {
  const hotelId = texto(formulario, "hotelId");
  await ejecutar(`/admin/hoteles/${hotelId}`, async () => {
    await cargarTarifaNeta(await exigirWopa(), {
      hotelId,
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

export async function cargarCuposAccion(formulario: FormData): Promise<void> {
  const hotelId = texto(formulario, "hotelId");
  await ejecutar(`/admin/hoteles/${hotelId}`, async () => {
    const cupo = texto(formulario, "cupoTotal");
    await cargarCupos(await exigirWopa(), {
      hotelId,
      tipoHabitacionId: texto(formulario, "tipoHabitacionId"),
      desde: texto(formulario, "desde"),
      hasta: texto(formulario, "hasta"),
      cupoTotal: cupo === "" ? undefined : Number(cupo),
      cerrado: formulario.get("cerrado") === "on",
    });
  });
}

export async function invitarAccion(formulario: FormData): Promise<void> {
  const hotelId = texto(formulario, "hotelId");
  await ejecutar(`/admin/hoteles/${hotelId}`, async () => {
    await invitarUsuario({
      sesion: await exigirWopa(),
      organizacionId: texto(formulario, "organizacionId"),
      correo: texto(formulario, "correo"),
      rol: texto(formulario, "rol") as Rol,
      urlBase: urlBase(),
    });
  });
}

export async function atenderAlertaAccion(formulario: FormData): Promise<void> {
  await ejecutar("/admin", async () => {
    await atenderAlerta(await exigirWopa(), texto(formulario, "alertaId"), texto(formulario, "accion") === "descartar");
  });
}

export async function aceptarSolicitudAccion(formulario: FormData): Promise<void> {
  await ejecutar("/admin/reservas", async () => {
    await aceptarSolicitud(await exigirWopa(), texto(formulario, "reservaId"), urlBase());
  });
}

export async function rechazarSolicitudAccion(formulario: FormData): Promise<void> {
  await ejecutar("/admin/reservas", async () => {
    await rechazarSolicitud(await exigirWopa(), texto(formulario, "reservaId"), "Sin disponibilidad");
  });
}

export async function responderTicketAccion(formulario: FormData): Promise<void> {
  const ticketId = texto(formulario, "ticketId");
  await ejecutar(`/admin/soporte/${ticketId}`, async () => {
    await responderTicket(await exigirWopa(), {
      ticketId,
      contenido: texto(formulario, "contenido"),
      notaInterna: formulario.get("notaInterna") === "on",
      nuevoEstado: (texto(formulario, "nuevoEstado") || undefined) as "en_progreso" | "esperando_cliente" | "resuelto" | "cerrado" | undefined,
    });
  });
}

export async function generarLiquidacionAccion(formulario: FormData): Promise<void> {
  await ejecutar("/admin/pagos", async () => {
    await generarLiquidacion(await exigirWopa(), { hotelId: texto(formulario, "hotelId"), desde: texto(formulario, "desde"), hasta: texto(formulario, "hasta") });
  });
}

export async function aprobarLiquidacionAccion(formulario: FormData): Promise<void> {
  await ejecutar("/admin/pagos", async () => {
    await aprobarLiquidacion(await exigirWopa(), texto(formulario, "liquidacionId"));
  });
}

export async function pagarLiquidacionAccion(formulario: FormData): Promise<void> {
  await ejecutar("/admin/pagos", async () => {
    await marcarLiquidacionPagada(await exigirWopa(), texto(formulario, "liquidacionId"), texto(formulario, "referencia"));
  });
}

export async function completarReembolsoAccion(formulario: FormData): Promise<void> {
  await ejecutar("/admin/pagos", async () => {
    await completarReembolsoManual(await exigirWopa(), texto(formulario, "reembolsoId"), texto(formulario, "referencia"));
  });
}

export async function resolverRevisionAccion(formulario: FormData): Promise<void> {
  await ejecutar("/admin/salud", async () => {
    await resolverRevision(await exigirWopa(), texto(formulario, "revisionId"), texto(formulario, "accion") === "aprobar", texto(formulario, "comentario") || null);
  });
}

export async function moderarResenaAccion(formulario: FormData): Promise<void> {
  await ejecutar("/admin/resenas", async () => {
    await moderarResena(await exigirWopa(), texto(formulario, "resenaId"), texto(formulario, "accion") === "publicar");
  });
}
