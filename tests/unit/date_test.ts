import { assertEquals, assertThrows } from "@std/assert";
import { addMonthsClamped, isValidBusinessDate, todayUtc } from "../../src/shared/utils/date.ts";

Deno.test("isValidBusinessDate aceita datas reais", () => {
  assertEquals(isValidBusinessDate("2026-01-31"), true);
  assertEquals(isValidBusinessDate("2024-02-29"), true);
  assertEquals(isValidBusinessDate("2026-12-31"), true);
});

Deno.test("isValidBusinessDate rejeita formato e dias inexistentes", () => {
  assertEquals(isValidBusinessDate("2026-02-30"), false);
  assertEquals(isValidBusinessDate("2025-02-29"), false);
  assertEquals(isValidBusinessDate("2026-13-01"), false);
  assertEquals(isValidBusinessDate("31/01/2026"), false);
  assertEquals(isValidBusinessDate("2026-1-1"), false);
});

Deno.test("addMonthsClamped ajusta para o último dia do mês", () => {
  assertEquals(addMonthsClamped("2026-01-31", 1), "2026-02-28");
  assertEquals(addMonthsClamped("2024-01-31", 1), "2024-02-29");
  assertEquals(addMonthsClamped("2026-03-31", 1), "2026-04-30");
  assertEquals(addMonthsClamped("2026-01-15", 1), "2026-02-15");
});

Deno.test("addMonthsClamped atravessa anos e aceita deslocamento negativo", () => {
  assertEquals(addMonthsClamped("2025-12-15", 1), "2026-01-15");
  assertEquals(addMonthsClamped("2026-01-15", -1), "2025-12-15");
  assertEquals(addMonthsClamped("2026-05-31", -3), "2026-02-28");
  assertEquals(addMonthsClamped("2026-01-31", 0), "2026-01-31");
});

Deno.test("addMonthsClamped rejeita data e deslocamento inválidos", () => {
  assertThrows(() => addMonthsClamped("2026-02-30", 1), RangeError);
  assertThrows(() => addMonthsClamped("2026-01-01", 1.5), RangeError);
});

Deno.test("todayUtc devolve YYYY-MM-DD", () => {
  assertEquals(todayUtc(new Date("2026-11-05T23:59:59Z")), "2026-11-05");
  assertEquals(todayUtc(new Date("2026-01-01T00:00:00Z")), "2026-01-01");
});
