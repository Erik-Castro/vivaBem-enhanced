import { addDays, daysBetween, isoWeekday, isValidBusinessDate } from "../../shared/utils/date.ts";

/**
 * Regras puras de agenda, streak e calendário de hábitos.
 *
 * O cálculo é inteiramente baseado em datas de negócio (`YYYY-MM-DD`) e
 * aritmética UTC — DST e fusos não alteram o dia. Streaks pulam dias não
 * agendados e nunca "quebram" o dia corrente de um hábito bom antes de ele
 * terminar.
 */

export type HabitType = "good" | "bad";
export type HabitFrequencyType = "daily" | "weekly" | "custom";
export type HabitDayStatus = "completed" | "missed" | "not_scheduled" | "pending";

export interface HabitSchedule {
  readonly habitType: HabitType;
  readonly frequencyType: HabitFrequencyType;
  /** Dias ISO (1 = segunda … 7 = domingo); vazio para `daily`. */
  readonly daysOfWeek: readonly number[];
  readonly dailyTarget: number;
  /** Primeira data em que o hábito passou a existir (data de criação). */
  readonly startDate: string;
}

export interface HabitLogEntry {
  readonly logDate: string;
  readonly value: number;
  readonly note?: string | null;
  readonly triggerId?: string | null;
  readonly replacementUsed?: boolean;
}

export interface HabitStreak {
  readonly currentStreak: number;
  readonly longestStreak: number;
  readonly lastCompletedDate: string | null;
  readonly scheduledToday: boolean;
  readonly completedToday: boolean;
}

export interface HabitCalendarDay {
  readonly date: string;
  readonly scheduled: boolean;
  readonly completed: boolean;
  readonly status: HabitDayStatus;
  readonly value: number | null;
  readonly note: string | null;
  readonly triggerId: string | null;
  readonly replacementUsed: boolean;
}

/** Um dia só conta para o hábito quando ele existe e está na agenda. */
export function isHabitScheduledOn(habit: HabitSchedule, date: string): boolean {
  assertBusinessDate(date);
  if (date < habit.startDate) return false;

  switch (habit.frequencyType) {
    case "daily":
      return true;
    case "weekly":
    case "custom":
      return habit.daysOfWeek.includes(isoWeekday(date));
  }
}

/**
 * Um dia agendado é considerado cumprido quando:
 * - hábito bom: existe log com `value >= daily_target`;
 * - hábito ruim: não existe log ou o log registra `value <= 0` (dia limpo).
 */
export function isHabitDayCompleted(
  habit: HabitSchedule,
  log: HabitLogEntry | undefined,
): boolean {
  if (habit.habitType === "good") {
    return log !== undefined && log.value >= habit.dailyTarget;
  }

  return log === undefined || log.value <= 0;
}

/** Calcula o streak corrente e o recorde histórico até `today`. */
export function computeHabitStreak(
  habit: HabitSchedule,
  logs: readonly HabitLogEntry[],
  today: string,
): HabitStreak {
  assertBusinessDate(habit.startDate);
  assertBusinessDate(today);

  const logsByDate = indexLogs(logs);
  const completedOn = (date: string): boolean => isHabitDayCompleted(habit, logsByDate.get(date));

  const scheduledToday = isHabitScheduledOn(habit, today);
  const completedToday = completedOn(today);

  let longestStreak = 0;
  let running = 0;

  if (habit.startDate <= today) {
    for (let date = habit.startDate; date <= today; date = addDays(date, 1)) {
      if (!isHabitScheduledOn(habit, date)) continue;

      if (completedOn(date)) {
        running++;
        if (running > longestStreak) longestStreak = running;
      } else {
        running = 0;
      }
    }
  }

  // O dia corrente de um hábito bom ainda não terminou: não o trate como
  // quebra. Para hábito ruim, a ausência de log já significa dia limpo.
  let cursor = today;
  if (scheduledToday && !completedToday && habit.habitType === "good") {
    cursor = addDays(today, -1);
  }

  let currentStreak = 0;
  let lastCompletedDate: string | null = null;

  while (cursor >= habit.startDate) {
    if (isHabitScheduledOn(habit, cursor)) {
      if (!completedOn(cursor)) break;

      currentStreak++;
      if (lastCompletedDate === null) lastCompletedDate = cursor;
    }

    cursor = addDays(cursor, -1);
  }

  return {
    currentStreak,
    longestStreak,
    lastCompletedDate,
    scheduledToday,
    completedToday,
  };
}

/**
 * Monta o calendário fechado `[from, to]` com o estado de cada dia.
 *
 * `today` define o único dia que pode ficar `pending`: um hábito bom agendado
 * para hoje e ainda não cumprido. Dias futuros aparecem como `not_scheduled`
 * apenas se não fizerem parte da agenda; caso contrário ficam `pending`.
 */
export function buildHabitCalendar(
  habit: HabitSchedule,
  logs: readonly HabitLogEntry[],
  from: string,
  to: string,
  today: string,
): HabitCalendarDay[] {
  assertBusinessDate(from);
  assertBusinessDate(to);
  assertBusinessDate(today);

  if (from > to) {
    throw new RangeError("`from` não pode ser posterior a `to`");
  }
  if (daysBetween(from, to) > 366) {
    throw new RangeError("O calendário aceita no máximo 366 dias");
  }

  const logsByDate = indexLogs(logs);
  const days: HabitCalendarDay[] = [];

  for (let date = from; date <= to; date = addDays(date, 1)) {
    const log = logsByDate.get(date);
    const scheduled = isHabitScheduledOn(habit, date);
    const completed = scheduled && date <= today && isHabitDayCompleted(habit, log);

    let status: HabitDayStatus;
    if (!scheduled) {
      status = "not_scheduled";
    } else if (date > today) {
      status = "pending";
    } else if (completed) {
      status = "completed";
    } else if (date === today && habit.habitType === "good") {
      status = "pending";
    } else {
      status = "missed";
    }

    days.push({
      date,
      scheduled,
      completed,
      status,
      value: log?.value ?? null,
      note: log?.note ?? null,
      triggerId: log?.triggerId ?? null,
      replacementUsed: log?.replacementUsed ?? false,
    });
  }

  return days;
}

function indexLogs(logs: readonly HabitLogEntry[]): Map<string, HabitLogEntry> {
  const byDate = new Map<string, HabitLogEntry>();

  for (const log of logs) {
    if (!isValidBusinessDate(log.logDate)) continue;
    byDate.set(log.logDate, log);
  }

  return byDate;
}

function assertBusinessDate(date: string): void {
  if (!isValidBusinessDate(date)) {
    throw new RangeError(`Data inválida: ${date}`);
  }
}
