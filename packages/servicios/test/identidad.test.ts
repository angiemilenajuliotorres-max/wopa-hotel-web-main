import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { crearAdministradorWopa } from "@wopa/db";
import { crearBaseMigrada, type BaseDePrueba } from "@wopa/db/pruebas";
import { codigoTotp } from "@wopa/dominio/identidad";
import {
  aceptarInvitacion,
  cerrarSesion,
  confirmarConfiguracion2fa,
  consultarInvitacion,
  esWopa,
  hotelesDe,
  iniciarConfiguracion2fa,
  iniciarSesion,
  invitarUsuario,
  obtenerSesion,
  verificarSegundoFactor,
} from "../src/identidad.ts";

process.env.SECRETO_CIFRADO = randomBytes(32).toString("base64");
const CLAVE = "clave de prueba muy segura";
let db: BaseDePrueba;
const secretos = new Map<string, string>();

before(async () => {
  db = await crearBaseMigrada();
  await crearAdministradorWopa(db, { correo: "admin@wopa.test", nombre: "Admin WOPA", clave: CLAVE });
});
after(async () => {
  await db.close();
});

/** Las pruebas inician varias sesiones en el mismo intervalo de 30 s: se olvida el último código usado. */
async function permitirNuevoCodigo(correo: string): Promise<void> {
  await db.query("UPDATE identidad.credenciales SET totp_ultimo_paso = NULL WHERE usuario_id = (SELECT id FROM identidad.usuarios WHERE correo = $1)", [correo]);
}

/** Inicia sesión completa (configurando la 2FA la primera vez) y devuelve el token. */
async function entrar(correo: string, clave = CLAVE): Promise<string> {
  const { token, siguientePaso } = await iniciarSesion({ correo, clave, ip: "10.0.0.1" }, db);
  if (siguientePaso === "configurar_2fa") {
    const { secreto } = await iniciarConfiguracion2fa(token, db);
    secretos.set(correo, secreto);
    await confirmarConfiguracion2fa(token, codigoTotp(secreto), db);
  } else {
    await permitirNuevoCodigo(correo);
    await verificarSegundoFactor(token, codigoTotp(secretos.get(correo)!), "10.0.0.1", db);
  }
  return token;
}

describe("inicio de sesión con verificación en dos pasos obligatoria", () => {
  test("el primer acceso exige configurar la 2FA y sin ella no hay permisos", async () => {
    const { token, siguientePaso } = await iniciarSesion({ correo: "ADMIN@wopa.test ", clave: CLAVE }, db);
    assert.equal(siguientePaso, "configurar_2fa");
    const sesion = await obtenerSesion(token, db);
    assert.equal(sesion?.segundoFactorOk, false);
    assert.equal(esWopa(sesion!), false);

    const { secreto, uri } = await iniciarConfiguracion2fa(token, db);
    assert.match(uri, /^otpauth:\/\/totp\//);
    await assert.rejects(confirmarConfiguracion2fa(token, "000000", db), { codigo: "CODIGO_INVALIDO" });
    await confirmarConfiguracion2fa(token, codigoTotp(secreto), db);
    secretos.set("admin@wopa.test", secreto);

    const confirmada = await obtenerSesion(token, db);
    assert.equal(confirmada?.segundoFactorOk, true);
    assert.equal(esWopa(confirmada!), true);
  });

  test("los accesos siguientes piden el código", async () => {
    const { token, siguientePaso } = await iniciarSesion({ correo: "admin@wopa.test", clave: CLAVE }, db);
    assert.equal(siguientePaso, "verificar_2fa");
    await assert.rejects(verificarSegundoFactor(token, "123456", null, db), { codigo: "CODIGO_INVALIDO" });
    await permitirNuevoCodigo("admin@wopa.test");
    await verificarSegundoFactor(token, codigoTotp(secretos.get("admin@wopa.test")!), null, db);
    assert.equal((await obtenerSesion(token, db))?.segundoFactorOk, true);
  });

  test("un código ya usado no sirve para otra sesión", async () => {
    await permitirNuevoCodigo("admin@wopa.test");
    const primera = await iniciarSesion({ correo: "admin@wopa.test", clave: CLAVE }, db);
    const segunda = await iniciarSesion({ correo: "admin@wopa.test", clave: CLAVE }, db);
    const codigo = codigoTotp(secretos.get("admin@wopa.test")!, Date.now() + 30_000); // paso siguiente: nunca usado antes
    await verificarSegundoFactor(primera.token, codigo, null, db);
    await assert.rejects(verificarSegundoFactor(segunda.token, codigo, null, db), { codigo: "CODIGO_INVALIDO" });
  });

  test("correo inexistente y clave incorrecta dan el mismo error", async () => {
    await assert.rejects(iniciarSesion({ correo: "nadie@wopa.test", clave: CLAVE }, db), { codigo: "CREDENCIALES_INVALIDAS" });
    await assert.rejects(iniciarSesion({ correo: "admin@wopa.test", clave: "incorrecta incorrecta" }, db), { codigo: "CREDENCIALES_INVALIDAS" });
  });

  test("bloquea tras 5 fallos aunque luego llegue la clave correcta", async () => {
    await crearAdministradorWopa(db, { correo: "bloqueo@wopa.test", nombre: "Bloqueo", clave: CLAVE });
    for (let intento = 0; intento < 5; intento++) {
      await assert.rejects(iniciarSesion({ correo: "bloqueo@wopa.test", clave: "otra clave errónea" }, db), { codigo: "CREDENCIALES_INVALIDAS" });
    }
    await assert.rejects(iniciarSesion({ correo: "bloqueo@wopa.test", clave: CLAVE }, db), { codigo: "ACCESO_BLOQUEADO" });
  });

  test("cerrar sesión invalida el token", async () => {
    const token = await entrar("admin@wopa.test");
    await cerrarSesion(token, db);
    assert.equal(await obtenerSesion(token, db), null);
    assert.equal(await obtenerSesion("token-inventado", db), null);
  });
});

describe("invitaciones (cuentas creadas por WOPA)", () => {
  let hotelA: string;
  let hotelB: string;

  before(async () => {
    const crear = async (nombre: string) =>
      (await db.query<{ id: string }>("INSERT INTO identidad.organizaciones (nombre, tipo) VALUES ($1, 'hotel') RETURNING id", [nombre])).rows[0].id;
    hotelA = await crear("Hotel A");
    hotelB = await crear("Hotel B");
  });

  test("WOPA invita al responsable del hotel, que activa su cuenta una sola vez", async () => {
    const admin = (await obtenerSesion(await entrar("admin@wopa.test"), db))!;
    const { token } = await invitarUsuario({ sesion: admin, organizacionId: hotelA, correo: "gerente@hotela.test", rol: "hotel_admin", urlBase: "https://wopa.test" }, db);

    const correo = await db.query<{ para: string; cuerpo_texto: string }>("SELECT para, cuerpo_texto FROM notificaciones.correos WHERE plantilla = 'invitacion'");
    assert.equal(correo.rows[0].para, "gerente@hotela.test");
    assert.ok(correo.rows[0].cuerpo_texto.includes("https://wopa.test/acceso/invitacion?token="));

    assert.deepEqual(await consultarInvitacion(token, db), { correo: "gerente@hotela.test", organizacion: "Hotel A", rol: "hotel_admin" });
    await assert.rejects(aceptarInvitacion({ token, nombre: "Gerente", clave: "corta" }, db), { codigo: "CLAVE_DEBIL" });
    await aceptarInvitacion({ token, nombre: "Gerente A", clave: CLAVE }, db);
    await assert.rejects(aceptarInvitacion({ token, nombre: "Gerente A", clave: CLAVE }, db), { codigo: "INVITACION_INVALIDA" });

    const gerente = (await obtenerSesion(await entrar("gerente@hotela.test"), db))!;
    assert.deepEqual(hotelesDe(gerente), [hotelA]);
    assert.equal(esWopa(gerente), false);
  });

  test("un hotel_admin solo invita personal de su propio hotel", async () => {
    const gerente = (await obtenerSesion(await entrar("gerente@hotela.test"), db))!;
    await invitarUsuario({ sesion: gerente, organizacionId: hotelA, correo: "recepcion@hotela.test", rol: "hotel_recepcion", urlBase: "https://wopa.test" }, db);
    await assert.rejects(
      invitarUsuario({ sesion: gerente, organizacionId: hotelB, correo: "x@hotelb.test", rol: "hotel_recepcion", urlBase: "https://wopa.test" }, db),
      { codigo: "SIN_PERMISO" },
    );
    const wopa = (await db.query<{ id: string }>("SELECT id FROM identidad.organizaciones WHERE tipo = 'wopa'")).rows[0].id;
    await assert.rejects(
      invitarUsuario({ sesion: gerente, organizacionId: wopa, correo: "y@wopa.test", rol: "wopa_admin", urlBase: "https://wopa.test" }, db),
      { codigo: "SIN_PERMISO" },
    );
  });

  test("si la organización se desactiva, su personal ya no puede entrar", async () => {
    await db.query("UPDATE identidad.organizaciones SET esta_activa = false WHERE id = $1", [hotelA]);
    await assert.rejects(iniciarSesion({ correo: "gerente@hotela.test", clave: CLAVE }, db), { codigo: "CREDENCIALES_INVALIDAS" });
    await db.query("UPDATE identidad.organizaciones SET esta_activa = true WHERE id = $1", [hotelA]);
  });
});
