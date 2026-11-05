import { assertEquals } from "@std/assert";
import { isValidDuration, parseDurationSeconds } from "../../src/shared/utils/duration.ts";

Deno.test("parseDurationSeconds converte unidades", () => {
  assertEquals(parseDurationSeconds("45s"), 45);
  assertEquals(parseDurationSeconds("15m"), 900);
  assertEquals(parseDurationSeconds("2h"), 7_200);
  assertEquals(parseDurationSeconds("30d"), 2_592_000);
});

Deno.test("parseDurationSeconds rejeita formatos inválidos", () => {
  assertEquals(parseDurationSeconds("15"), undefined);
  assertEquals(parseDurationSeconds("15 minutos"), undefined);
  assertEquals(parseDurationSeconds("-15m"), undefined);
  assertEquals(parseDurationSeconds("1w"), undefined);
});

Deno.test("isValidDuration valida o formato", () => {
  assertEquals(isValidDuration("15m"), true);
  assertEquals(isValidDuration("abc"), false);
});
