const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Codifica bytes em base64url sem padding (RFC 4648 §5). */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** Decodifica base64url. Lança em entrada inválida. */
export function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Gera um token opaco criptograficamente seguro (padrão: 32 bytes). */
export function generateOpaqueToken(bytes = 32): string {
  if (!Number.isInteger(bytes) || bytes < 16) {
    throw new RangeError("Um token opaco precisa de pelo menos 16 bytes");
  }
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return base64UrlEncode(buffer);
}

/** SHA-256 em hexadecimal minúsculo. Usado para persistir hashes de tokens. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Compara duas strings em tempo constante (sobre o comprimento menor).
 * Ideal para tokens CSRF; hashes de refresh usam comparação por igualdade no
 * banco, já que o valor é derivado e não reversível.
 */
export function timingSafeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let index = 0; index < length; index++) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}

export function decodeUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}
