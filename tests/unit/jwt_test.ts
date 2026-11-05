import { assertEquals } from "@std/assert";
import { signAccessToken, verifyAccessToken } from "../../src/shared/crypto/jwt.ts";

const SECRET = "segredo-de-teste-com-32-caracteres!!";

function payload(expOffsetSeconds = 900) {
  const issuedAt = Math.floor(Date.now() / 1_000);
  return {
    sub: "0198f3c2-0000-7000-8000-000000000001",
    sid: "0198f3c2-0000-7000-8000-000000000002",
    iat: issuedAt,
    exp: issuedAt + expOffsetSeconds,
  };
}

Deno.test("assina e verifica um access token", async () => {
  const expected = payload();
  const token = await signAccessToken(expected, SECRET);
  const verified = await verifyAccessToken(token, SECRET);

  assertEquals(verified, expected);
  assertEquals(token.split(".").length, 3);
});

Deno.test("rejeita token assinado com outro segredo", async () => {
  const token = await signAccessToken(payload(), SECRET);

  assertEquals(await verifyAccessToken(token, `${SECRET}-outro`), null);
});

Deno.test("rejeita token adulterado", async () => {
  const token = await signAccessToken(payload(), SECRET);
  const [header, body, signature] = token.split(".");
  const tampered = `${header}.${body}.${signature?.slice(0, -2)}aa`;

  assertEquals(await verifyAccessToken(tampered, SECRET), null);
});

Deno.test("rejeita token expirado", async () => {
  const token = await signAccessToken(payload(-60), SECRET);

  assertEquals(await verifyAccessToken(token, SECRET), null);
});

Deno.test("rejeita token malformado", async () => {
  assertEquals(await verifyAccessToken("nao-e-um-jwt", SECRET), null);
  assertEquals(await verifyAccessToken("a.b", SECRET), null);
  assertEquals(await verifyAccessToken("", SECRET), null);
});
