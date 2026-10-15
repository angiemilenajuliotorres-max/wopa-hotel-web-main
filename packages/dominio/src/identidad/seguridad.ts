/**
 * Primitivas de seguridad de identidad (ADR-012), solo con node:crypto:
 * - contraseñas con scrypt y sal aleatoria;
 * - tokens de sesión e invitación aleatorios, guardados como sha256;
 * - TOTP (RFC 6238) para el segundo factor;
 * - cifrado AES-256-GCM para guardar el secreto TOTP.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------- contraseñas

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, longitud: 64 };
export const LONGITUD_MINIMA_CLAVE = 12;

function derivar(clave: string, sal: Buffer, N: number, r: number, p: number, longitud: number): Promise<Buffer> {
  return new Promise((resolver, rechazar) => {
    scrypt(clave.normalize("NFKC"), sal, longitud, { N, r, p, maxmem: 128 * N * r * 2 }, (error, derivada) =>
      error ? rechazar(error) : resolver(derivada),
    );
  });
}

export function validarClave(clave: string): string | null {
  if (clave.length < LONGITUD_MINIMA_CLAVE) return `La contraseña debe tener al menos ${LONGITUD_MINIMA_CLAVE} caracteres.`;
  if (clave.length > 200) return "La contraseña es demasiado larga.";
  return null;
}

/** Formato: scrypt$N$r$p$sal$hash (base64url). */
export async function hashearClave(clave: string): Promise<string> {
  const error = validarClave(clave);
  if (error) throw new Error(error);
  const sal = randomBytes(16);
  const derivada = await derivar(clave, sal, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.longitud);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, sal.toString("base64url"), derivada.toString("base64url")].join("$");
}

export async function verificarClave(clave: string, guardado: string): Promise<boolean> {
  const partes = guardado.split("$");
  if (partes.length !== 6 || partes[0] !== "scrypt") return false;
  const [, N, r, p, salTexto, hashTexto] = partes;
  const esperado = Buffer.from(hashTexto, "base64url");
  const derivada = await derivar(clave, Buffer.from(salTexto, "base64url"), Number(N), Number(r), Number(p), esperado.length);
  return derivada.length === esperado.length && timingSafeEqual(derivada, esperado);
}

// ---------------------------------------------------------------- tokens

/** Token para cookies o enlaces de invitación: 256 bits aleatorios. */
export function generarToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Lo que se guarda en la base: nunca el token en claro. */
export function huellaToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ---------------------------------------------------------------- TOTP (RFC 6238)

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function aBase32(datos: Buffer): string {
  let bits = 0;
  let valor = 0;
  let salida = "";
  for (const byte of datos) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += BASE32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += BASE32[(valor << (5 - bits)) & 31];
  return salida;
}

export function desdeBase32(texto: string): Buffer {
  const limpio = texto.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const caracter of limpio) {
    const indice = BASE32.indexOf(caracter);
    if (indice === -1) throw new Error("Secreto TOTP inválido.");
    valor = (valor << 5) | indice;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generarSecretoTotp(): string {
  return aBase32(randomBytes(20));
}

export function codigoTotp(secretoBase32: string, momentoMs: number = Date.now(), digitos = 6, pasoSegundos = 30): string {
  const contador = Math.floor(momentoMs / 1000 / pasoSegundos);
  const mensaje = Buffer.alloc(8);
  mensaje.writeBigUInt64BE(BigInt(contador));
  const hmac = createHmac("sha1", desdeBase32(secretoBase32)).update(mensaje).digest();
  const desplazamiento = hmac[hmac.length - 1] & 0x0f;
  const binario = hmac.readUInt32BE(desplazamiento) & 0x7fffffff;
  return String(binario % 10 ** digitos).padStart(digitos, "0");
}

/**
 * Paso de tiempo (número de ventana de 30 s) que coincide con el código, aceptando un paso antes o después
 * por desfase de reloj. null si no coincide. Guardar el último paso usado impide reutilizar un código.
 */
export function pasoTotp(secretoBase32: string, codigo: string, momentoMs: number = Date.now()): number | null {
  if (!/^\d{6}$/.test(codigo)) return null;
  for (const desfase of [-1, 0, 1]) {
    const momento = momentoMs + desfase * 30_000;
    const esperado = Buffer.from(codigoTotp(secretoBase32, momento));
    if (timingSafeEqual(esperado, Buffer.from(codigo))) return Math.floor(momento / 30_000);
  }
  return null;
}

/** Acepta el código actual y el de un paso antes o después (desfase de reloj). */
export function verificarTotp(secretoBase32: string, codigo: string, momentoMs: number = Date.now()): boolean {
  return pasoTotp(secretoBase32, codigo, momentoMs) !== null;
}

export function uriTotp(secretoBase32: string, correo: string, emisor = "WOPA Travel"): string {
  const etiqueta = encodeURIComponent(`${emisor}:${correo}`);
  return `otpauth://totp/${etiqueta}?secret=${secretoBase32}&issuer=${encodeURIComponent(emisor)}&algorithm=SHA1&digits=6&period=30`;
}

// ---------------------------------------------------------------- cifrado

/** AES-256-GCM. La clave es base64 de 32 bytes (variable SECRETO_CIFRADO). Formato: iv.tag.datos */
export function cifrar(texto: string, claveBase64: string): string {
  const clave = Buffer.from(claveBase64, "base64");
  if (clave.length !== 32) throw new Error("SECRETO_CIFRADO debe ser base64 de 32 bytes.");
  const iv = randomBytes(12);
  const cifrador = createCipheriv("aes-256-gcm", clave, iv);
  const datos = Buffer.concat([cifrador.update(texto, "utf8"), cifrador.final()]);
  return [iv, cifrador.getAuthTag(), datos].map((parte) => parte.toString("base64url")).join(".");
}

export function descifrar(cifrado: string, claveBase64: string): string {
  const [iv, tag, datos] = cifrado.split(".").map((parte) => Buffer.from(parte, "base64url"));
  const descifrador = createDecipheriv("aes-256-gcm", Buffer.from(claveBase64, "base64"), iv);
  descifrador.setAuthTag(tag);
  return Buffer.concat([descifrador.update(datos), descifrador.final()]).toString("utf8");
}
