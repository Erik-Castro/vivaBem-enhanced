import { assertEquals, assertThrows } from "@std/assert";
import {
  addDays,
  addMonthsClamped,
  addMonthsWithDay,
  dayOfMonth,
  daysBetween,
  isoWeekday,
  isValidBusinessDate,
  monthBounds,
  todayUtc,
  yearBounds,
} from "../../src/shared/utils/date.ts";

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

Deno.test("addMonthsWithDay mantém o dia-alvo entre meses", () => {
  assertEquals(addMonthsWithDay("2026-01-31", 1, 31), "2026-02-28");
  assertEquals(addMonthsWithDay("2026-02-28", 1, 31), "2026-03-31");
  assertEquals(addMonthsWithDay("2026-01-15", 1, 15), "2026-02-15");
  assertEquals(addMonthsWithDay("2025-12-31", 1, 31), "2026-01-31");
  assertEquals(addMonthsWithDay("2026-01-31", 12, 31), "2027-01-31");
});

Deno.test("addMonthsWithDay rejeita dia-alvo inválido", () => {
  assertThrows(() => addMonthsWithDay("2026-01-01", 1, 0), RangeError);
  assertThrows(() => addMonthsWithDay("2026-01-01", 1, 32), RangeError);
  assertThrows(() => addMonthsWithDay("2026-02-30", 1, 15), RangeError);
});

Deno.test("addDays atravessa meses e anos", () => {
  assertEquals(addDays("2026-01-31", 1), "2026-02-01");
  assertEquals(addDays("2026-12-31", 1), "2027-01-01");
  assertEquals(addDays("2026-01-01", -1), "2025-12-31");
  assertEquals(addDays("2024-02-28", 1), "2024-02-29");
});

Deno.test("monthBounds e yearBounds devolvem o intervalo fechado", () => {
  assertEquals(monthBounds("2026-02-15"), { from: "2026-02-01", to: "2026-02-28" });
  assertEquals(monthBounds("2024-02-15"), { from: "2024-02-01", to: "2024-02-29" });
  assertEquals(monthBounds("2026-12-01"), { from: "2026-12-01", to: "2026-12-31" });
  assertEquals(yearBounds("2026-07-01"), { from: "2026-01-01", to: "2026-12-31" });
});

Deno.test("daysBetween e dayOfMonth são consistentes", () => {
  assertEquals(daysBetween("2026-01-01", "2026-01-31"), 30);
  assertEquals(daysBetween("2026-01-31", "2026-01-01"), -30);
  assertEquals(daysBetween("2024-02-28", "2024-03-01"), 2);
  assertEquals(dayOfMonth("2026-11-05"), 5);
});

Deno.test("isoWeekday usa a convenção ISO (segunda = 1 … domingo = 7)", () => {
  assertEquals(isoWeekday("2026-11-02"), 1);
  assertEquals(isoWeekday("2026-11-05"), 4);
  assertEquals(isoWeekday("2026-11-08"), 7);
  assertEquals(isoWeekday("2024-02-29"), 4);
});

Deno.test("isoWeekday rejeita datas inválidas", () => {
  assertThrows(() => isoWeekday("2026-02-30"), RangeError);
  assertThrows(() => isoWeekday("05/11/2026"), RangeError);
});
