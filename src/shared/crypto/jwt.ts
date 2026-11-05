import { base64UrlDecode, base64UrlEncode, decodeUtf8 } from "./tokens.ts";

export interface AccessTokenPayload {
  /** ID do usuário (`user_profiles.id`). */
  readonly sub: string;
  /** ID da sessão (`user_sessions.id`). */
  readonly sid: string;
  /** Emitido em (epoch seconds). */
  readonly iat: number;
  /** Expira em (epoch seconds). */
  readonly exp: number;
}

const HEADER = { alg: "HS256", typ: "JWT" } as const;
const encoder = new TextEncoder();

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Assina um access token JWT HS256. */
export async function signAccessToken(
  payload: AccessTokenPayload,
  secret: string,
): Promise<string> {
  const header = base64UrlEncode(encoder.encode(JSON.stringify(HEADER)));
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${header}.${body}`;

  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));

  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Verifica assinatura, algoritmo e expiração. Retorna `null` para qualquer
 * token inválido — nunca lança, para não vazar detalhes ao cliente.
 */
export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<AccessTokenPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedBody, encodedSignature] = parts as [string, string, string];

  try {
    const key = await importHmacKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecode(encodedSignature) as unknown as BufferSource,
      encoder.encode(`${encodedHeader}.${encodedBody}`),
    );
    if (!valid) return null;

    const header = JSON.parse(decodeUtf8(base64UrlDecode(encodedHeader))) as { alg?: unknown };
    if (header.alg !== "HS256") return null;

    const payload = JSON.parse(decodeUtf8(base64UrlDecode(encodedBody))) as Partial<
      AccessTokenPayload
    >;

    if (
      typeof payload.sub !== "string" ||
      typeof payload.sid !== "string" ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }

    if (payload.exp <= Math.floor(Date.now() / 1_000)) return null;

    return {
      sub: payload.sub,
      sid: payload.sid,
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}
