import { ErrorNegocio } from "@wopa/servicios";

/** Mensajes en español para el panel y el acceso (el equipo interno opera en español). */
const MENSAJES: Record<string, string> = {
  CREDENCIALES_INVALIDAS: "Correo o contraseña incorrectos.",
  ACCESO_BLOQUEADO: "Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.",
  CODIGO_INVALIDO: "El código no es válido. Revisa la hora de tu teléfono e inténtalo de nuevo.",
  SESION_INVALIDA: "Tu sesión expiró. Vuelve a iniciar sesión.",
  INVITACION_INVALIDA: "La invitación no es válida o ya venció. Pide una nueva a WOPA.",
  CLAVE_DEBIL: "La contraseña debe tener al menos 12 caracteres.",
  CLAVES_DISTINTAS: "Las contraseñas no coinciden.",
  NOMBRE_INVALIDO: "Escribe tu nombre.",
  SIN_PERMISO: "No tienes permiso para esta acción.",
  CONFIGURACION_INCOMPLETA: "Falta configuración del servidor (SECRETO_CIFRADO). Avísale al equipo técnico.",
  MARGEN_INVALIDO: "El margen no es válido.",
  AJUSTE_SOLAPADO: "Ya hay un margen programado que empieza en esa fecha o después.",
  AJUSTE_PARCIAL: "Ese ajuste con fecha de fin queda dentro de otra regla; usa una regla por plan o cierra la vigente.",
  MOTIVO_OBLIGATORIO: "Escribe el motivo del ajuste.",
  ESTADO_INVALIDO: "La acción no aplica al estado actual.",
  RANGO_INVALIDO: "El rango de fechas no es válido.",
  PRECIO_INVALIDO: "La tarifa debe ser mayor que cero.",
  CUPO_MENOR_A_VENDIDO: "El cupo no puede ser menor que lo ya vendido.",
  CORREO_INVALIDO: "El correo no es válido.",
  DATOS_INVALIDOS: "Revisa los datos del formulario.",
  DESCRIPCION_CORTA: "La descripción debe tener al menos 20 caracteres.",
  ASUNTO_INVALIDO: "Escribe un asunto.",
  MENSAJE_INVALIDO: "Escribe el mensaje.",
  MONEDAS_MEZCLADAS: "Las reservas del periodo están en monedas distintas.",
  REFERENCIA_OBLIGATORIA: "Escribe la referencia de la transferencia.",
};

export function codigoDeError(error: unknown): string {
  if (error instanceof ErrorNegocio) return error.codigo;
  console.error(error);
  return "ERROR_INESPERADO";
}

export function mensajeDeError(codigo: string | undefined | string[]): string | null {
  if (!codigo || Array.isArray(codigo)) return null;
  return MENSAJES[codigo] ?? "Ocurrió un error inesperado. Inténtalo de nuevo.";
}
