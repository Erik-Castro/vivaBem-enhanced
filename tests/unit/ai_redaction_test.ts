import { assertEquals } from "@std/assert";
import { redactForProvider } from "../../src/ai/ai.redaction.ts";

Deno.test("redação remove e-mail, CPF e telefone", () => {
  const redacted = redactForProvider(
    "Fale com ana.silva@example.com, CPF 123.456.789-09, tel (11) 98765-4321",
  );

  assertEquals(
    redacted,
    "Fale com [EMAIL], CPF [CPF], tel [TELEFONE]",
  );
});

Deno.test("redação remove números longos (cartão/conta)", () => {
  const redacted = redactForProvider("cartão 4111111111111111 e conta 1234567890123456");
  assertEquals(redacted, "cartão [NÚMERO] e conta [NÚMERO]");
});

Deno.test("redação substitui chaves sensíveis em objetos aninhados", () => {
  const redacted = redactForProvider({
    user: {
      email: "ana@example.com",
      password: "segredo",
      apiKey: "sk-123",
      profile: { name: "Ana", token: "abc" },
    },
    authorization: "Bearer xyz",
  });

  assertEquals(redacted, {
    user: {
      email: "[EMAIL]",
      password: "[REMOVIDO]",
      apiKey: "[REMOVIDO]",
      profile: { name: "Ana", token: "[REMOVIDO]" },
    },
    authorization: "[REMOVIDO]",
  });
});

Deno.test("redação preserva números, booleanos e null", () => {
  assertEquals(redactForProvider({ amountMinor: 1234, ok: true, missing: null }), {
    amountMinor: 1234,
    ok: true,
    missing: null,
  });
});

Deno.test("redação trunca strings muito longas", () => {
  const redacted = redactForProvider("x".repeat(5_000)) as string;
  assertEquals(redacted.length, 4_000);
});

Deno.test("redação limita a profundidade do objeto", () => {
  let value: unknown = "fim";
  for (let index = 0; index < 10; index++) {
    value = { nested: value };
  }

  const redacted = redactForProvider(value) as Record<string, unknown>;
  // Navega até o ponto de truncamento sem depender do formato interno.
  let cursor: unknown = redacted;
  for (let index = 0; index < 7; index++) {
    cursor = (cursor as Record<string, unknown>).nested;
  }
  assertEquals(cursor, "[TRUNCADO]");
});

Deno.test("redação remove PII de arrays", () => {
  const redacted = redactForProvider(["ana@example.com", { phone: "(11) 98765-4321" }]);
  assertEquals(redacted, ["[EMAIL]", { phone: "[TELEFONE]" }]);
});
