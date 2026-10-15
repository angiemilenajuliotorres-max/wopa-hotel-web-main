/**
 * Identidad (ADR-004, ADR-012): inicio de sesión con contraseña + TOTP obligatorio,
 * sesiones con token opaco, invitaciones creadas por WOPA y bloqueo de fuerza bruta.
 */
import {
  cifrar,
  descifrar,
  generarSecretoTotp,
  generarToken,
  hashearClave,
  huellaToken,
  uriTotp,
  validarClave,
  verificarClave,
  verificarTotp,
} from "@wopa/dominio/identidad";
import { registrarEvento } from "./auditoria.ts";
import { db, enTransaccion, ErrorNegocio, type Consulta } from "./conexion.ts";
import { encolarCorreo } from "./notificaciones.ts";

export const DURACION_SESION_HORAS = 12;
export const DURACION_INVITACION_HORAS = 72;
const VENTANA_BLOQUEO_MINUTOS = 15;
const MAX_FALLOS_POR_CORREO = 5;
const MAX_FALLOS_POR_IP = 30;

export type Rol = "wopa_admin" | "wopa_operaciones" | "wopa_soporte" | "wopa_finanzas" | "hotel_admin" | "hotel_recepcion";

export interface Membresia {
  organizacionId: string;
  organizacionTipo: "wopa" | "hotel";
  organizacionNombre: string;
  rol: Rol;
}

export interface SesionActiva {
  sesionId: string;
  usuario: { id: string; correo: string; nombre: string; idioma: string };
  segundoFactorOk: boolean;
  tiene2fa: boolean;
  membresias: Membresia[];
  expiraEn: Date;
}

export type SiguientePaso = "verificar_2fa" | "configurar_2fa";

// Hash válido de una clave aleatoria: se verifica cuando el correo no existe para que
// el tiempo de respuesta no revele qué correos están registrados.
let hashSenuelo: Promise<string> | undefined;
function obtenerHashSenuelo(): Promise<string> {
  hashSenuelo ??= hashearClave(generarToken());
  return hashSenuelo;
}

function claveCifrado(): string {
  const clave = process.env.SECRETO_CIFRADO;
  if (!clave) throw new ErrorNegocio("CONFIGURACION_INCOMPLETA", "Falta SECRETO_CIFRADO para la verificación en dos pasos.", { estado: 500 });
  return clave;
}

async function estaBloqueado(conexion: Consulta, correo: string, ip: string | null): Promise<boolean> {
  const { rows } = await conexion.query<{ por_correo: number; por_ip: number }>(
    `SELECT
       count(*) FILTER (WHERE correo = $1)::int AS por_correo,
       count(*) FILTER (WHERE $2::text IS NOT NULL AND ip = $2)::int AS por_ip
     FROM identidad.intentos_acceso
     WHERE NOT exito AND creado_en > now() - make_interval(mins => $3)`,
    [correo, ip, VENTANA_BLOQUEO_MINUTOS],
  );
  return rows[0].por_correo >= MAX_FALLOS_POR_CORREO || rows[0].por_ip >= MAX_FALLOS_POR_IP;
}

async function registrarIntento(conexion: Consulta, correo: string, ip: string | null, exito: boolean): Promise<void> {
  await conexion.query("INSERT INTO identidad.intentos_acceso (correo, ip, exito) VALUES ($1, $2, $3)", [correo, ip, exito]);
}

export async function iniciarSesion(
  datos: { correo: string; clave: string; ip?: string | null; agente?: string | null },
  cliente?: Consulta,
): Promise<{ token: string; siguientePaso: SiguientePaso }> {
  const conexion = db(cliente);
  const correo = datos.correo.trim().toLowerCase();
  const ip = datos.ip ?? null;

  if (await estaBloqueado(conexion, correo, ip)) {
    throw new ErrorNegocio("ACCESO_BLOQUEADO", `Demasiados intentos. Espera ${VENTANA_BLOQUEO_MINUTOS} minutos.`, { estado: 429 });
  }

  const { rows } = await conexion.query<{ id: string; clave_hash: string; totp_activado_en: Date | null }>(
    `SELECT u.id, c.clave_hash, c.totp_activado_en
     FROM identidad.usuarios u JOIN identidad.credenciales c ON c.usuario_id = u.id
     WHERE u.correo = $1 AND u.esta_activo
       AND EXISTS (SELECT 1 FROM identidad.membresias m JOIN identidad.organizaciones o ON o.id = m.organizacion_id
                   WHERE m.usuario_id = u.id AND o.esta_activa)`,
    [correo],
  );
  const usuario = rows[0];
  const claveCorrecta = await verificarClave(datos.clave, usuario?.clave_hash ?? (await obtenerHashSenuelo()));

  if (!usuario || !claveCorrecta) {
    await registrarIntento(conexion, correo, ip, false);
    throw new ErrorNegocio("CREDENCIALES_INVALIDAS", "Correo o contraseña incorrectos.", { estado: 401 });
  }

  await registrarIntento(conexion, correo, ip, true);
  const token = generarToken();
  await conexion.query(
    `INSERT INTO identidad.sesiones (usuario_id, token_hash, ip, agente, expira_en)
     VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5))`,
    [usuario.id, huellaToken(token), ip, datos.agente?.slice(0, 300) ?? null, DURACION_SESION_HORAS],
  );
  return { token, siguientePaso: usuario.totp_activado_en ? "verificar_2fa" : "configurar_2fa" };
}

export async function obtenerSesion(token: string | undefined | null, cliente?: Consulta): Promise<SesionActiva | null> {
  if (!token) return null;
  const conexion = db(cliente);
  const { rows } = await conexion.query<{
    sesion_id: string; usuario_id: string; correo: string; nombre: string; idioma: string;
    segundo_factor_ok: boolean; tiene_2fa: boolean; expira_en: Date; ultima_actividad_en: Date;
  }>(
    `SELECT s.id AS sesion_id, u.id AS usuario_id, u.correo, u.nombre, u.idioma_codigo AS idioma, s.segundo_factor_ok,
            (c.totp_activado_en IS NOT NULL) AS tiene_2fa, s.expira_en, s.ultima_actividad_en
     FROM identidad.sesiones s
     JOIN identidad.usuarios u ON u.id = s.usuario_id AND u.esta_activo
     LEFT JOIN identidad.credenciales c ON c.usuario_id = u.id
     WHERE s.token_hash = $1 AND s.revocada_en IS NULL AND s.expira_en > now()`,
    [huellaToken(token)],
  );
  const fila = rows[0];
  if (!fila) return null;

  if (Date.now() - new Date(fila.ultima_actividad_en).getTime() > 5 * 60_000) {
    await conexion.query("UPDATE identidad.sesiones SET ultima_actividad_en = now() WHERE id = $1", [fila.sesion_id]);
  }
  const membresias = await conexion.query<{ organizacion_id: string; tipo: "wopa" | "hotel"; nombre: string; rol: Rol }>(
    `SELECT m.organizacion_id, o.tipo, o.nombre, m.rol FROM identidad.membresias m
     JOIN identidad.organizaciones o ON o.id = m.organizacion_id AND o.esta_activa
     WHERE m.usuario_id = $1 ORDER BY o.tipo DESC, o.nombre`,
    [fila.usuario_id],
  );
  return {
    sesionId: fila.sesion_id,
    usuario: { id: fila.usuario_id, correo: fila.correo, nombre: fila.nombre, idioma: fila.idioma },
    segundoFactorOk: fila.segundo_factor_ok,
    tiene2fa: fila.tiene_2fa,
    membresias: membresias.rows.map((m) => ({ organizacionId: m.organizacion_id, organizacionTipo: m.tipo, organizacionNombre: m.nombre, rol: m.rol })),
    expiraEn: new Date(fila.expira_en),
  };
}

async function sesionObligatoria(token: string, conexion: Consulta): Promise<SesionActiva> {
  const sesion = await obtenerSesion(token, conexion);
  if (!sesion) throw new ErrorNegocio("SESION_INVALIDA", "Tu sesión expiró. Vuelve a iniciar sesión.", { estado: 401 });
  return sesion;
}

/** Genera el secreto TOTP (aún sin activar) y devuelve la URI para el código QR. */
export async function iniciarConfiguracion2fa(token: string, cliente?: Consulta): Promise<{ secreto: string; uri: string }> {
  const conexion = db(cliente);
  const sesion = await sesionObligatoria(token, conexion);
  if (sesion.tiene2fa) throw new ErrorNegocio("2FA_YA_CONFIGURADA", "La verificación en dos pasos ya está activa.", { estado: 409 });
  const secreto = generarSecretoTotp();
  await conexion.query("UPDATE identidad.credenciales SET totp_secreto_cifrado = $2 WHERE usuario_id = $1", [
    sesion.usuario.id,
    cifrar(secreto, claveCifrado()),
  ]);
  return { secreto, uri: uriTotp(secreto, sesion.usuario.correo) };
}

async function secretoDe(conexion: Consulta, usuarioId: string): Promise<string | null> {
  const { rows } = await conexion.query<{ totp_secreto_cifrado: string | null }>(
    "SELECT totp_secreto_cifrado FROM identidad.credenciales WHERE usuario_id = $1",
    [usuarioId],
  );
  const cifrado = rows[0]?.totp_secreto_cifrado;
  return cifrado ? descifrar(cifrado, claveCifrado()) : null;
}

export async function confirmarConfiguracion2fa(token: string, codigo: string, cliente?: Consulta): Promise<void> {
  await enTransaccion(async (tx) => {
    const sesion = await sesionObligatoria(token, tx);
    if (sesion.tiene2fa) throw new ErrorNegocio("2FA_YA_CONFIGURADA", "La verificación en dos pasos ya está activa.", { estado: 409 });
    const secreto = await secretoDe(tx, sesion.usuario.id);
    if (!secreto || !verificarTotp(secreto, codigo.trim())) {
      throw new ErrorNegocio("CODIGO_INVALIDO", "El código no es válido. Revisa la hora de tu teléfono e inténtalo de nuevo.", { campo: "codigo" });
    }
    await tx.query("UPDATE identidad.credenciales SET totp_activado_en = now() WHERE usuario_id = $1", [sesion.usuario.id]);
    await tx.query("UPDATE identidad.sesiones SET segundo_factor_ok = true WHERE id = $1", [sesion.sesionId]);
    await registrarEvento({ entidad: "usuario", entidadId: sesion.usuario.id, accion: "2fa_activada", actor: { tipo: "usuario", usuarioId: sesion.usuario.id } }, tx);
  }, cliente);
}

export async function verificarSegundoFactor(token: string, codigo: string, ip?: string | null, cliente?: Consulta): Promise<void> {
  const conexion = db(cliente);
  const sesion = await sesionObligatoria(token, conexion);
  if (await estaBloqueado(conexion, sesion.usuario.correo, ip ?? null)) {
    throw new ErrorNegocio("ACCESO_BLOQUEADO", `Demasiados intentos. Espera ${VENTANA_BLOQUEO_MINUTOS} minutos.`, { estado: 429 });
  }
  const secreto = await secretoDe(conexion, sesion.usuario.id);
  if (!sesion.tiene2fa || !secreto || !verificarTotp(secreto, codigo.trim())) {
    await registrarIntento(conexion, sesion.usuario.correo, ip ?? null, false);
    throw new ErrorNegocio("CODIGO_INVALIDO", "El código no es válido.", { estado: 401, campo: "codigo" });
  }
  await conexion.query("UPDATE identidad.sesiones SET segundo_factor_ok = true WHERE id = $1", [sesion.sesionId]);
}

export async function cerrarSesion(token: string, cliente?: Consulta): Promise<void> {
  await db(cliente).query("UPDATE identidad.sesiones SET revocada_en = now() WHERE token_hash = $1 AND revocada_en IS NULL", [huellaToken(token)]);
}

// ---------------------------------------------------------------- permisos

export function esWopa(sesion: SesionActiva, roles: Rol[] = ["wopa_admin", "wopa_operaciones", "wopa_soporte", "wopa_finanzas"]): boolean {
  return sesion.segundoFactorOk && sesion.membresias.some((m) => m.organizacionTipo === "wopa" && roles.includes(m.rol));
}

export function hotelesDe(sesion: SesionActiva, roles: Rol[] = ["hotel_admin", "hotel_recepcion"]): string[] {
  if (!sesion.segundoFactorOk) return [];
  return sesion.membresias.filter((m) => m.organizacionTipo === "hotel" && roles.includes(m.rol)).map((m) => m.organizacionId);
}

/** WOPA (admin u operaciones) invita a cualquiera; un hotel_admin solo invita a su propia organización. */
export function puedeInvitar(sesion: SesionActiva, organizacionId: string, organizacionTipo: "wopa" | "hotel", rol: Rol): boolean {
  if (!sesion.segundoFactorOk) return false;
  if (organizacionTipo === "wopa") return esWopa(sesion, ["wopa_admin"]) && rol.startsWith("wopa_");
  if (esWopa(sesion, ["wopa_admin", "wopa_operaciones"])) return rol.startsWith("hotel_");
  return hotelesDe(sesion, ["hotel_admin"]).includes(organizacionId) && rol.startsWith("hotel_");
}

// ---------------------------------------------------------------- invitaciones

export async function invitarUsuario(
  datos: { sesion: SesionActiva; organizacionId: string; correo: string; rol: Rol; urlBase: string; idioma?: "es" | "en" },
  cliente?: Consulta,
): Promise<{ invitacionId: string; token: string }> {
  return enTransaccion(async (tx) => {
    const organizacion = (await tx.query<{ tipo: "wopa" | "hotel"; nombre: string }>(
      "SELECT tipo, nombre FROM identidad.organizaciones WHERE id = $1 AND esta_activa",
      [datos.organizacionId],
    )).rows[0];
    if (!organizacion) throw new ErrorNegocio("ORGANIZACION_NO_ENCONTRADA", "La organización no existe.", { estado: 404 });
    if (!puedeInvitar(datos.sesion, datos.organizacionId, organizacion.tipo, datos.rol)) {
      throw new ErrorNegocio("SIN_PERMISO", "No tienes permiso para invitar con ese rol.", { estado: 403 });
    }
    const correo = datos.correo.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) throw new ErrorNegocio("CORREO_INVALIDO", "El correo no es válido.", { campo: "correo" });

    const token = generarToken();
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO identidad.invitaciones (organizacion_id, organizacion_tipo, correo, rol, token_hash, expira_en, creado_por)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6), $7) RETURNING id`,
      [datos.organizacionId, organizacion.tipo, correo, datos.rol, huellaToken(token), DURACION_INVITACION_HORAS, datos.sesion.usuario.id],
    );
    const enlace = `${datos.urlBase.replace(/\/$/, "")}/acceso/invitacion?token=${encodeURIComponent(token)}`;
    const ingles = datos.idioma === "en";
    await encolarCorreo(
      {
        para: correo,
        plantilla: "invitacion",
        idioma: ingles ? "en" : "es",
        asunto: ingles ? `You're invited to ${organizacion.nombre} on WOPA Travel` : `Te invitaron a ${organizacion.nombre} en WOPA Travel`,
        texto: ingles
          ? `${datos.sesion.usuario.nombre} invited you to manage ${organizacion.nombre}.\n\nActivate your account (valid for 72 hours):\n${enlace}`
          : `${datos.sesion.usuario.nombre} te invitó a gestionar ${organizacion.nombre}.\n\nActiva tu cuenta (válido por 72 horas):\n${enlace}`,
      },
      tx,
    );
    await registrarEvento(
      { entidad: "invitacion", entidadId: rows[0].id, accion: "creada", actor: { tipo: "usuario", usuarioId: datos.sesion.usuario.id }, despues: { correo, rol: datos.rol, organizacion: datos.organizacionId } },
      tx,
    );
    return { invitacionId: rows[0].id, token };
  }, cliente);
}

export async function consultarInvitacion(token: string, cliente?: Consulta): Promise<{ correo: string; organizacion: string; rol: Rol } | null> {
  const { rows } = await db(cliente).query<{ correo: string; nombre: string; rol: Rol }>(
    `SELECT i.correo, o.nombre, i.rol FROM identidad.invitaciones i JOIN identidad.organizaciones o ON o.id = i.organizacion_id
     WHERE i.token_hash = $1 AND i.aceptada_en IS NULL AND i.expira_en > now()`,
    [huellaToken(token)],
  );
  return rows[0] ? { correo: rows[0].correo, organizacion: rows[0].nombre, rol: rows[0].rol } : null;
}

export async function aceptarInvitacion(datos: { token: string; nombre: string; clave: string }, cliente?: Consulta): Promise<{ usuarioId: string }> {
  const errorClave = validarClave(datos.clave);
  if (errorClave) throw new ErrorNegocio("CLAVE_DEBIL", errorClave, { campo: "clave" });
  const nombre = datos.nombre.trim();
  if (nombre.length < 2) throw new ErrorNegocio("NOMBRE_INVALIDO", "Escribe tu nombre.", { campo: "nombre" });
  const claveHash = await hashearClave(datos.clave);

  return enTransaccion(async (tx) => {
    const invitacion = (await tx.query<{ id: string; correo: string; rol: Rol; organizacion_id: string; organizacion_tipo: string }>(
      `SELECT id, correo, rol, organizacion_id, organizacion_tipo FROM identidad.invitaciones
       WHERE token_hash = $1 AND aceptada_en IS NULL AND expira_en > now() FOR UPDATE`,
      [huellaToken(datos.token)],
    )).rows[0];
    if (!invitacion) throw new ErrorNegocio("INVITACION_INVALIDA", "La invitación no es válida o ya venció. Pide una nueva.", { estado: 410 });

    const existente = (await tx.query<{ id: string }>("SELECT id FROM identidad.usuarios WHERE correo = $1", [invitacion.correo])).rows[0];
    const usuarioId =
      existente?.id ?? (await tx.query<{ id: string }>("INSERT INTO identidad.usuarios (correo, nombre) VALUES ($1, $2) RETURNING id", [invitacion.correo, nombre])).rows[0].id;
    if (!existente) {
      await tx.query("INSERT INTO identidad.credenciales (usuario_id, clave_hash) VALUES ($1, $2)", [usuarioId, claveHash]);
    }
    await tx.query(
      `INSERT INTO identidad.membresias (usuario_id, organizacion_id, organizacion_tipo, rol) VALUES ($1, $2, $3, $4)
       ON CONFLICT (usuario_id, organizacion_id) DO UPDATE SET rol = EXCLUDED.rol`,
      [usuarioId, invitacion.organizacion_id, invitacion.organizacion_tipo, invitacion.rol],
    );
    await tx.query("UPDATE identidad.invitaciones SET aceptada_en = now() WHERE id = $1", [invitacion.id]);
    await registrarEvento({ entidad: "invitacion", entidadId: invitacion.id, accion: "aceptada", actor: { tipo: "usuario", usuarioId } }, tx);
    return { usuarioId };
  }, cliente);
}
