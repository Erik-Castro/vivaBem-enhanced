import { assertEquals, assertMatch } from "@std/assert";
import { hashPassword, verifyPassword } from "../../src/shared/helpers/argon2id.ts";

const ARGON2ID_PATTERN = /^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/;

// Parâmetros baixos deixam o teste rápido; a produção usa os valores de config.
const TEST_OPTIONS = { memoryKiB: 1_024, iterations: 1, parallelism: 1 };

Deno.test("hashPassword gera hash Argon2id no formato PHC", async () => {
  const hash = await hashPassword("senha-secreta", TEST_OPTIONS);

  assertMatch(hash, ARGON2ID_PATTERN);
  assertEquals(hash.startsWith("$argon2id$"), true);
});

Deno.test("verifyPassword aceita a senha correta", async () => {
  const hash = await hashPassword("Cavalo02", TEST_OPTIONS);

  assertEquals(await verifyPassword(hash, "Cavalo02"), true);
});

Deno.test("verifyPassword rejeita a senha errada", async () => {
  const hash = await hashPassword("Cavalo02", TEST_OPTIONS);

  assertEquals(await verifyPassword(hash, "cavalo02"), false);
});
