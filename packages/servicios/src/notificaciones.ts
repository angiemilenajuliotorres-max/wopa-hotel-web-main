/**
 * Correos transaccionales con bandeja de salida (notificaciones.correos).
 * Sin RESEND_API_KEY los correos quedan como 'simulado' y se pueden leer en el panel.
 */
import { db, type Consulta } from "./conexion.ts";

export interface Correo {
  para: string;
  asunto: string;
  texto: string;
  html?: string;
  plantilla: string;
  idioma: string;
}

export async function encolarCorreo(correo: Correo, cliente?: Consulta): Promise<string> {
  const { rows } = await db(cliente).query<{ id: string }>(
    `INSERT INTO notificaciones.correos (para, asunto, cuerpo_texto, cuerpo_html, plantilla, idioma_codigo)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [correo.para, correo.asunto, correo.texto, correo.html ?? null, correo.plantilla, correo.idioma],
  );
  return rows[0].id;
}

type Enviador = (correo: { para: string; asunto: string; texto: string; html: string | null }) => Promise<string>;

function enviadorResend(claveApi: string, remitente: string): Enviador {
  return async ({ para, asunto, texto, html }) => {
    const respuesta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${claveApi}`, "content-type": "application/json" },
      body: JSON.stringify({ from: remitente, to: [para], subject: asunto, text: texto, ...(html ? { html } : {}) }),
    });
    if (!respuesta.ok) throw new Error(`Resend respondió ${respuesta.status}: ${await respuesta.text()}`);
    return ((await respuesta.json()) as { id: string }).id;
  };
}

/** Procesa la cola. Lo llama un cron (Vercel Cron) o el propio flujo tras encolar. */
export async function procesarCorreosPendientes(limite = 20, cliente?: Consulta): Promise<{ enviados: number; simulados: number; fallidos: number }> {
  const conexion = db(cliente);
  const clave = process.env.RESEND_API_KEY;
  const enviar = clave ? enviadorResend(clave, process.env.CORREO_REMITENTE ?? "WOPA Travel <reservas@wopa.travel>") : null;
  const { rows } = await conexion.query<{ id: string; para: string; asunto: string; cuerpo_texto: string; cuerpo_html: string | null }>(
    `SELECT id, para, asunto, cuerpo_texto, cuerpo_html FROM notificaciones.correos
     WHERE estado = 'pendiente' AND intentos < 5 ORDER BY creado_en LIMIT $1 FOR UPDATE SKIP LOCKED`,
    [limite],
  );
  const conteo = { enviados: 0, simulados: 0, fallidos: 0 };
  for (const correo of rows) {
    if (!enviar) {
      await conexion.query("UPDATE notificaciones.correos SET estado = 'simulado', enviado_en = now() WHERE id = $1", [correo.id]);
      conteo.simulados++;
      continue;
    }
    try {
      const idProveedor = await enviar({ para: correo.para, asunto: correo.asunto, texto: correo.cuerpo_texto, html: correo.cuerpo_html });
      await conexion.query("UPDATE notificaciones.correos SET estado = 'enviado', enviado_en = now(), proveedor_id = $2, intentos = intentos + 1 WHERE id = $1", [correo.id, idProveedor]);
      conteo.enviados++;
    } catch (error) {
      await conexion.query(
        "UPDATE notificaciones.correos SET intentos = intentos + 1, ultimo_error = $2, estado = CASE WHEN intentos + 1 >= 5 THEN 'fallido' ELSE 'pendiente' END WHERE id = $1",
        [correo.id, error instanceof Error ? error.message : String(error)],
      );
      conteo.fallidos++;
    }
  }
  return conteo;
}

/** Últimos correos de la bandeja de salida (para revisar los simulados mientras no hay proveedor). */
export async function listarCorreos(limite = 100, cliente?: Consulta) {
  const { rows } = await db(cliente).query<{ id: string; para: string; asunto: string; cuerpo_texto: string; plantilla: string; estado: string; creado_en: Date }>(
    "SELECT id, para, asunto, cuerpo_texto, plantilla, estado, creado_en FROM notificaciones.correos ORDER BY creado_en DESC LIMIT $1",
    [limite],
  );
  return rows;
}
