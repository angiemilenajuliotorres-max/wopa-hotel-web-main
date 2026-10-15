import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";
import {
  aBase32,
  cifrar,
  codigoTotp,
  desdeBase32,
  descifrar,
  generarSecretoTotp,
  generarToken,
  hashearClave,
  huellaToken,
  uriTotp,
  verificarClave,
  verificarTotp,
} from "../../src/identidad/index.ts";

describe("contraseñas", () => {
  test("hashea con scrypt y verifica solo la clave correcta", async () => {
    const hash = await hashearClave("una clave larga y segura");
    assert.match(hash, /^scrypt\$32768\$8\$1\$/);
    assert.equal(await verificarClave("una clave larga y segura", hash), true);
    assert.equal(await verificarClave("otra clave distinta!!", hash), false);
  });

  test("dos hashes de la misma clave son distintos (sal aleatoria)", async () => {
    assert.notEqual(await hashearClave("misma clave de prueba"), await hashearClave("misma clave de prueba"));
  });

  test("rechaza claves cortas y hashes mal formados", async () => {
    await assert.rejects(hashearClave("corta"), /al menos 12/);
    assert.equal(await verificarClave("cualquier cosa larga", "md5$abc"), false);
  });
});

describe("tokens", () => {
  test("son aleatorios y se guardan como sha256", () => {
    const token = generarToken();
    assert.equal(Buffer.from(token, "base64url").length, 32);
    assert.notEqual(generarToken(), token);
    assert.match(huellaToken(token), /^[0-9a-f]{64}$/);
  });
});

describe("TOTP (RFC 6238)", () => {
  // Vectores oficiales del RFC 6238 (SHA-1, secreto ASCII "12345678901234567890"), últimos 6 dígitos.
  const secreto = aBase32(Buffer.from("12345678901234567890"));
  const vectores: [number, string][] = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ];

  for (const [segundos, esperado] of vectores) {
    test(`código en t=${segundos}`, () => {
      assert.equal(codigoTotp(secreto, segundos * 1000), esperado);
    });
  }

  test("base32 ida y vuelta", () => {
    const datos = randomBytes(20);
    assert.deepEqual(desdeBase32(aBase32(datos)), datos);
  });

  test("acepta un paso de desfase y rechaza códigos viejos o inválidos", () => {
    const secretoNuevo = generarSecretoTotp();
    const ahora = 1_800_000_000_000;
    assert.equal(verificarTotp(secretoNuevo, codigoTotp(secretoNuevo, ahora - 30_000), ahora), true);
    assert.equal(verificarTotp(secretoNuevo, codigoTotp(secretoNuevo, ahora - 120_000), ahora), false);
    assert.equal(verificarTotp(secretoNuevo, "12a456", ahora), false);
  });

  test("URI para la app autenticadora", () => {
    assert.match(uriTotp("ABC", "ana@wopa.test"), /^otpauth:\/\/totp\/WOPA%20Travel%3Aana%40wopa\.test\?secret=ABC&issuer=WOPA%20Travel/);
  });
});

describe("cifrado AES-256-GCM", () => {
  const clave = randomBytes(32).toString("base64");

  test("cifra y descifra", () => {
    const cifrado = cifrar("JBSWY3DPEHPK3PXP", clave);
    assert.notEqual(cifrado, "JBSWY3DPEHPK3PXP");
    assert.equal(descifrar(cifrado, clave), "JBSWY3DPEHPK3PXP");
  });

  test("detecta alteraciones y claves incorrectas", () => {
    const cifrado = cifrar("secreto", clave);
    const [iv, tag, datos] = cifrado.split(".");
    const alterado = [iv, tag, Buffer.from("otro").toString("base64url")].join(".");
    assert.throws(() => descifrar(alterado, clave));
    assert.throws(() => descifrar(cifrado, randomBytes(32).toString("base64")));
    assert.throws(() => cifrar("x", Buffer.from("corta").toString("base64")), /32 bytes/);
    void datos;
  });
});
