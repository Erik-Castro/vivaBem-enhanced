import { assertEquals, assertNotEquals } from "@std/assert";
import {
  base64UrlDecode,
  base64UrlEncode,
  generateOpaqueToken,
  sha256Hex,
  timingSafeEqual,
} from "../../src/shared/crypto/tokens.ts";

Deno.test("generateOpaqueToken gera valores base64url únicos", () => {
  const first = generateOpaqueToken();
  const second = generateOpaqueToken();

  assertEquals(/^[A-Za-z0-9_-]+$/.test(first), true);
  assertEquals(first.length >= 43, true);
  assertNotEquals(first, second);
});

Deno.test("generateOpaqueToken rejeita menos de 16 bytes", () => {
  let threw = false;
  try {
    generateOpaqueToken(8);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("base64url faz round-trip sem padding", () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  const encoded = base64UrlEncode(bytes);

  assertEquals(encoded.includes("="), false);
  assertEquals(encoded.includes("+"), false);
  assertEquals(encoded.includes("/"), false);
  assertEquals([...base64UrlDecode(encoded)], [...bytes]);
});

Deno.test("sha256Hex é determinístico e devolve 64 caracteres", async () => {
  const first = await sha256Hex("token-secreto");
  const second = await sha256Hex("token-secreto");

  assertEquals(first, second);
  assertEquals(first.length, 64);
  assertEquals(/^[0-9a-f]{64}$/.test(first), true);
  assertNotEquals(first, await sha256Hex("outro-token"));
});

Deno.test("timingSafeEqual compara conteúdo e comprimento", () => {
  assertEquals(timingSafeEqual("abc", "abc"), true);
  assertEquals(timingSafeEqual("abc", "abd"), false);
  assertEquals(timingSafeEqual("abc", "abcd"), false);
  assertEquals(timingSafeEqual("", ""), true);
});
