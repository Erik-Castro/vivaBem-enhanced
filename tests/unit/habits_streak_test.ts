import { assertEquals, assertThrows } from "@std/assert";
import {
  buildHabitCalendar,
  computeHabitStreak,
  type HabitLogEntry,
  type HabitSchedule,
  isHabitScheduledOn,
} from "../../src/modules/habits/habits.streak.ts";

function schedule(overrides: Partial<HabitSchedule> = {}): HabitSchedule {
  return {
    habitType: "good",
    frequencyType: "daily",
    daysOfWeek: [],
    dailyTarget: 1,
    startDate: "2026-11-02",
    ...overrides,
  };
}

function logs(...entries: Array<[string, number]>): HabitLogEntry[] {
  return entries.map(([logDate, value]) => ({ logDate, value }));
}

Deno.test("isHabitScheduledOn respeita frequência, dias ISO e data de criação", () => {
  assertEquals(isHabitScheduledOn(schedule(), "2026-11-05"), true);
  assertEquals(isHabitScheduledOn(schedule(), "2026-11-01"), false);

  const weekly = schedule({ frequencyType: "weekly", daysOfWeek: [1] });
  assertEquals(isHabitScheduledOn(weekly, "2026-11-02"), true);
  assertEquals(isHabitScheduledOn(weekly, "2026-11-03"), false);

  const custom = schedule({ frequencyType: "custom", daysOfWeek: [1, 3] });
  assertEquals(isHabitScheduledOn(custom, "2026-11-02"), true);
  assertEquals(isHabitScheduledOn(custom, "2026-11-04"), true);
  assertEquals(isHabitScheduledOn(custom, "2026-11-05"), false);
});

Deno.test("streak diário não quebra o dia corrente antes de ele terminar", () => {
  const habit = schedule();
  const partial = computeHabitStreak(
    habit,
    logs(["2026-11-02", 1], ["2026-11-03", 1], ["2026-11-04", 1]),
    "2026-11-05",
  );

  assertEquals(partial.currentStreak, 3);
  assertEquals(partial.longestStreak, 3);
  assertEquals(partial.lastCompletedDate, "2026-11-04");
  assertEquals(partial.scheduledToday, true);
  assertEquals(partial.completedToday, false);

  const complete = computeHabitStreak(
    habit,
    logs(
      ["2026-11-02", 1],
      ["2026-11-03", 1],
      ["2026-11-04", 1],
      ["2026-11-05", 1],
    ),
    "2026-11-05",
  );

  assertEquals(complete.currentStreak, 4);
  assertEquals(complete.longestStreak, 4);
  assertEquals(complete.lastCompletedDate, "2026-11-05");
  assertEquals(complete.completedToday, true);
});

Deno.test("streak diário para no primeiro dia agendado não cumprido", () => {
  const result = computeHabitStreak(
    schedule({ dailyTarget: 2 }),
    logs(["2026-11-02", 2], ["2026-11-03", 1], ["2026-11-04", 3], ["2026-11-05", 2]),
    "2026-11-05",
  );

  assertEquals(result.currentStreak, 2);
  assertEquals(result.longestStreak, 2);
  assertEquals(result.lastCompletedDate, "2026-11-05");
});

Deno.test("streak semanal e personalizado pulam dias não agendados", () => {
  const weekly = schedule({
    frequencyType: "weekly",
    daysOfWeek: [1],
    startDate: "2026-10-19",
  });
  const weeklyResult = computeHabitStreak(
    weekly,
    logs(["2026-10-19", 1], ["2026-10-26", 1], ["2026-11-02", 1]),
    "2026-11-05",
  );

  assertEquals(weeklyResult.currentStreak, 3);
  assertEquals(weeklyResult.longestStreak, 3);
  assertEquals(weeklyResult.scheduledToday, false);

  const custom = schedule({
    frequencyType: "custom",
    daysOfWeek: [1, 3],
    startDate: "2026-11-02",
  });
  const customResult = computeHabitStreak(
    custom,
    logs(["2026-11-02", 1], ["2026-11-04", 1]),
    "2026-11-05",
  );

  assertEquals(customResult.currentStreak, 2);
  assertEquals(customResult.longestStreak, 2);
  assertEquals(customResult.scheduledToday, false);
});

Deno.test("streak atravessa virada de mês e fevereiro bissexto sem DST", () => {
  const result = computeHabitStreak(
    schedule({ startDate: "2024-02-25" }),
    logs(
      ["2024-02-25", 1],
      ["2024-02-26", 1],
      ["2024-02-27", 1],
      ["2024-02-28", 1],
      ["2024-02-29", 1],
      ["2024-03-01", 1],
      ["2024-03-02", 1],
    ),
    "2024-03-02",
  );

  assertEquals(result.currentStreak, 7);
  assertEquals(result.longestStreak, 7);
  assertEquals(result.lastCompletedDate, "2024-03-02");
});

Deno.test("hábito ruim conta dias limpos, inclusive hoje sem log", () => {
  const habit = schedule({ habitType: "bad" });
  const clean = computeHabitStreak(habit, [], "2026-11-05");

  assertEquals(clean.currentStreak, 4);
  assertEquals(clean.longestStreak, 4);
  assertEquals(clean.completedToday, true);

  const slip = computeHabitStreak(habit, logs(["2026-11-04", 1]), "2026-11-05");
  assertEquals(slip.currentStreak, 1);
  assertEquals(slip.longestStreak, 2);

  const slipToday = computeHabitStreak(habit, logs(["2026-11-05", 2]), "2026-11-05");
  assertEquals(slipToday.currentStreak, 0);
  assertEquals(slipToday.longestStreak, 3);
  assertEquals(slipToday.completedToday, false);
});

Deno.test("calendário marca completed, missed, pending e not_scheduled", () => {
  const days = buildHabitCalendar(
    schedule(),
    logs(["2026-11-02", 1], ["2026-11-04", 1]),
    "2026-11-01",
    "2026-11-06",
    "2026-11-05",
  );

  assertEquals(days.map((day) => day.status), [
    "not_scheduled",
    "completed",
    "missed",
    "completed",
    "pending",
    "pending",
  ]);
  assertEquals(days[1]?.value, 1);
  assertEquals(days[2]?.value, null);
  assertEquals(days[4]?.scheduled, true);
  assertEquals(days[4]?.completed, false);
});

Deno.test("calendário para hábito ruim trata ausência de log como dia limpo", () => {
  const days = buildHabitCalendar(
    schedule({ habitType: "bad" }),
    logs(["2026-11-03", 2]),
    "2026-11-02",
    "2026-11-06",
    "2026-11-05",
  );

  assertEquals(days.map((day) => day.status), [
    "completed",
    "missed",
    "completed",
    "completed",
    "pending",
  ]);
});

Deno.test("calendário rejeita intervalo invertido ou maior que 366 dias", () => {
  const habit = schedule();

  assertThrows(
    () => buildHabitCalendar(habit, [], "2026-11-05", "2026-11-01", "2026-11-05"),
    RangeError,
  );
  assertThrows(
    () => buildHabitCalendar(habit, [], "2025-01-01", "2026-11-01", "2026-11-05"),
    RangeError,
  );
});
