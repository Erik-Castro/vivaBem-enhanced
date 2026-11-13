import { assertEquals } from "@std/assert";
import { base64UrlDecode, base64UrlEncode } from "../../src/shared/crypto/tokens.ts";
import { applicationServerKey, parseVapidJwk } from "../../src/shared/crypto/vapid.ts";

const X = base64UrlEncode(new Uint8Array(32).fill(1));
const Y = base64UrlEncode(new Uint8Array(32).fill(2));
const D = base64UrlEncode(new Uint8Array(32).fill(3));

Deno.test("lê JWK público e privado EC P-256", () => {
  const publicKey = parseVapidJwk(JSON.stringify({ kty: "EC", crv: "P-256", x: X, y: Y }));
  assertEquals(publicKey, { kty: "EC", crv: "P-256", x: X, y: Y });

  const privateKey = parseVapidJwk(
    JSON.stringify({ kty: "EC", crv: "P-256", x: X, y: Y, d: D }),
  );
  assertEquals(privateKey, { kty: "EC", crv: "P-256", x: X, y: Y, d: D });
});

Deno.test("rejeita JWK inválido", () => {
  assertEquals(parseVapidJwk("não é json"), null);
  assertEquals(parseVapidJwk("[]"), null);
  assertEquals(parseVapidJwk(JSON.stringify({ kty: "RSA" })), null);
  assertEquals(parseVapidJwk(JSON.stringify({ kty: "EC", crv: "P-384", x: X, y: Y })), null);
  assertEquals(
    parseVapidJwk(JSON.stringify({ kty: "EC", crv: "P-256", x: "curto", y: Y })),
    null,
  );
  assertEquals(
    parseVapidJwk(JSON.stringify({ kty: "EC", crv: "P-256", x: X, y: Y, d: "curto" })),
    null,
  );
});

Deno.test("applicationServerKey é o ponto não comprimido", () => {
  const jwk = { kty: "EC", crv: "P-256", x: X, y: Y } as const;
  const key = base64UrlDecode(applicationServerKey(jwk));

  assertEquals(key.length, 65);
  assertEquals(key[0], 4);
  assertEquals(key.slice(1, 33), base64UrlDecode(X));
  assertEquals(key.slice(33, 65), base64UrlDecode(Y));
});
