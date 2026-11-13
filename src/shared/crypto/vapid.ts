import { base64UrlDecode, base64UrlEncode } from "./tokens.ts";

/**
 * Chave VAPID em JWK (RFC 8292).
 *
 * O par de chaves é gerado uma única vez e configurado por ambiente; a pública
 * também alimenta o `applicationServerKey` que o navegador usa ao assinar.
 */
export interface VapidJwk {
  readonly kty: "EC";
  readonly crv: "P-256";
  readonly x: string;
  readonly y: string;
  /** Presente apenas na chave privada. */
  readonly d?: string;
}

const COORDINATE_BYTES = 32;

/**
 * Lê o JWK de uma chave VAPID.
 *
 * Retorna `null` (em vez de lançar) para que a validação de configuração possa
 * acumular todos os erros antes de interromper o boot.
 */
export function parseVapidJwk(value: string): VapidJwk | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  if (record.kty !== "EC" || record.crv !== "P-256") return null;
  if (!isCoordinate(record.x) || !isCoordinate(record.y)) return null;

  if (record.d === undefined) {
    return { kty: "EC", crv: "P-256", x: record.x, y: record.y };
  }

  if (!isCoordinate(record.d)) return null;
  return { kty: "EC", crv: "P-256", x: record.x, y: record.y, d: record.d };
}

/**
 * `applicationServerKey` do navegador: ponto não comprimido (0x04 || X || Y)
 * em base64url. O `x` e o `y` do JWK já são as coordenadas de 32 bytes.
 */
export function applicationServerKey(jwk: VapidJwk): string {
  const key = new Uint8Array(1 + COORDINATE_BYTES * 2);
  key[0] = 4;
  key.set(base64UrlDecode(jwk.x), 1);
  key.set(base64UrlDecode(jwk.y), 1 + COORDINATE_BYTES);
  return base64UrlEncode(key);
}

function isCoordinate(value: unknown): value is string {
  if (typeof value !== "string") return false;

  try {
    return base64UrlDecode(value).length === COORDINATE_BYTES;
  } catch {
    return false;
  }
}
