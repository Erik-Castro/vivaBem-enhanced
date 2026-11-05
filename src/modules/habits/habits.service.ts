import { AppError } from "../../http/errors.ts";
import type { AppDatabase } from "../../db/client.ts";
import type { EventPublisher } from "../../events/event-publisher.ts";
import { daysBetween, monthBounds, todayUtc } from "../../shared/utils/date.ts";
import { uuidv7 } from "../../shared/utils/uuid.ts";
import {
  buildHabitCalendar,
  computeHabitStreak,
  type HabitCalendarDay,
  type HabitFrequencyType,
  type HabitLogEntry,
  type HabitSchedule,
  type HabitStreak,
  type HabitType,
} from "./habits.streak.ts";
import type {
  Habit,
  HabitLog,
  HabitsRepository,
  HabitTrigger,
  ListHabitsOptions,
} from "./habits.repository.ts";

const MAX_HABIT_DEPTH = 5;
const MAX_CALENDAR_DAYS = 366;

export interface CreateHabitInput {
  readonly name: string;
  readonly description?: string | null;
  readonly color?: string | null;
  readonly habitType: HabitType;
  readonly frequencyType: HabitFrequencyType;
  readonly daysOfWeek?: readonly number[];
  readonly dailyTarget?: number;
  readonly targetUnit?: string | null;
  readonly orderIndex?: number;
  readonly parentHabitId?: string | null;
}

export interface UpdateHabitInput {
  readonly name?: string;
  readonly description?: string | null;
  readonly color?: string | null;
  readonly habitType?: HabitType;
  readonly frequencyType?: HabitFrequencyType;
  readonly daysOfWeek?: readonly number[];
  readonly dailyTarget?: number;
  readonly targetUnit?: string | null;
  readonly orderIndex?: number;
  readonly parentHabitId?: string | null;
  readonly isActive?: boolean;
}

export interface UpsertHabitLogInput {
  readonly logDate: string;
  readonly value?: number;
  readonly note?: string | null;
  readonly triggerId?: string | null;
  readonly replacementUsed?: boolean;
}

export interface ListLogsInput {
  readonly from?: string;
  readonly to?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface HabitLogPage {
  readonly logs: HabitLog[];
  readonly hasMore: boolean;
}

export interface HabitCalendar {
  readonly habitId: string;
  readonly from: string;
  readonly to: string;
  readonly days: HabitCalendarDay[];
}

export interface CreateTriggerInput {
  readonly badHabitId: string;
  readonly replacementHabitId?: string | null;
  readonly triggerDescription: string;
  readonly alternativeAction?: string | null;
}

export interface UpdateTriggerInput {
  readonly replacementHabitId?: string | null;
  readonly triggerDescription?: string;
  readonly alternativeAction?: string | null;
}

export interface HabitsServiceDependencies {
  readonly db: AppDatabase;
  readonly repository: HabitsRepository;
  readonly events?: EventPublisher;
}

export class HabitsService {
  readonly #db: AppDatabase;
  readonly #repository: HabitsRepository;
  readonly #events: EventPublisher | null;

  constructor(dependencies: HabitsServiceDependencies) {
    this.#db = dependencies.db;
    this.#repository = dependencies.repository;
    this.#events = dependencies.events ?? null;
  }

  list(userId: string, options: ListHabitsOptions = {}): Habit[] {
    return this.#repository.list(userId, options);
  }

  get(userId: string, habitId: string): Habit {
    return this.#requireHabit(userId, habitId);
  }

  create(userId: string, input: CreateHabitInput): Habit {
    const frequencyType = input.frequencyType;
    const daysOfWeek = normalizeDays(frequencyType, input.daysOfWeek ?? []);
    const parentHabitId = input.parentHabitId ?? null;

    this.#validateParent(userId, parentHabitId);

    const habitId = uuidv7();
    const now = new Date().toISOString();

    this.#repository.create({
      id: habitId,
      userId,
      name: input.name.trim(),
      description: normalizeText(input.description),
      color: normalizeColor(input.color),
      habitType: input.habitType,
      frequencyType,
      daysOfWeek,
      dailyTarget: input.dailyTarget ?? 1,
      targetUnit: normalizeText(input.targetUnit),
      orderIndex: input.orderIndex ?? this.#repository.nextOrderIndex(userId),
      parentHabitId,
      now,
    });

    this.#events?.publish({
      type: "habit.created",
      aggregateType: "habit",
      aggregateId: habitId,
      userId,
      payload: {
        habitId,
        name: input.name.trim(),
        habitType: input.habitType,
        frequencyType,
        daysOfWeek,
        dailyTarget: input.dailyTarget ?? 1,
      },
    });

    return this.get(userId, habitId);
  }

  update(userId: string, habitId: string, input: UpdateHabitInput): Habit {
    const current = this.#requireHabit(userId, habitId);

    const habitType = input.habitType ?? current.habitType;
    if (habitType !== current.habitType && this.#repository.hasLogs(habitId)) {
      throw new AppError(
        "CONFLICT",
        "O tipo do hábito não pode ser alterado depois de existirem registros",
      );
    }

    const frequencyType = input.frequencyType ?? current.frequencyType;
    const rawDays = frequencyType === "daily" ? [] : (input.daysOfWeek ?? current.daysOfWeek);
    const daysOfWeek = normalizeDays(frequencyType, rawDays);

    const parentHabitId = input.parentHabitId === undefined
      ? current.parentHabitId
      : input.parentHabitId;
    const isActive = input.isActive ?? current.isActive;

    if (parentHabitId !== current.parentHabitId || isActive) {
      this.#validateParent(userId, parentHabitId, habitId);
    }

    const now = new Date().toISOString();

    this.#db.transaction(() => {
      this.#repository.update({
        id: habitId,
        name: input.name === undefined ? current.name : input.name.trim(),
        description: input.description === undefined
          ? current.description
          : normalizeText(input.description),
        color: input.color === undefined ? current.color : normalizeColor(input.color),
        habitType,
        frequencyType,
        daysOfWeek,
        dailyTarget: input.dailyTarget ?? current.dailyTarget,
        targetUnit: input.targetUnit === undefined
          ? current.targetUnit
          : normalizeText(input.targetUnit),
        orderIndex: input.orderIndex ?? current.orderIndex,
        parentHabitId,
        isActive,
        now,
      });

      if (!isActive && current.isActive) {
        this.#deactivateTree(userId, habitId, now);
      }
    });

    return this.get(userId, habitId);
  }

  delete(userId: string, habitId: string): void {
    this.#requireHabit(userId, habitId);
    const now = new Date().toISOString();
    this.#db.transaction(() => this.#deactivateTree(userId, habitId, now));
  }

  /** Move o hábito para `orderIndex` e reindexa os irmãos de 0..n-1. */
  reorder(userId: string, habitId: string, orderIndex: number): Habit[] {
    const habit = this.#requireActiveHabit(userId, habitId);
    const habits = this.#repository.list(userId);

    const from = habits.findIndex((entry) => entry.id === habit.id);
    if (from === -1) {
      throw new AppError("NOT_FOUND", "Hábito não encontrado");
    }

    const target = Math.max(0, Math.min(orderIndex, habits.length - 1));
    const reordered = [...habits];
    const [moved] = reordered.splice(from, 1);
    if (moved === undefined) {
      throw new AppError("NOT_FOUND", "Hábito não encontrado");
    }
    reordered.splice(target, 0, moved);

    const now = new Date().toISOString();
    this.#db.transaction(() => {
      reordered.forEach((entry, index) => {
        if (entry.orderIndex !== index) {
          this.#repository.updateOrderIndex(entry.id, index, now);
        }
      });
    });

    return this.#repository.list(userId);
  }

  upsertLog(
    userId: string,
    habitId: string,
    input: UpsertHabitLogInput,
  ): { log: HabitLog; created: boolean } {
    const habit = this.#requireActiveHabit(userId, habitId);
    const today = todayUtc();
    const startDate = habit.createdAt.slice(0, 10);

    if (input.logDate > today) {
      throw validationError("logDate", "A data do registro não pode ser futura");
    }
    if (input.logDate < startDate) {
      throw validationError("logDate", "A data do registro é anterior ao hábito");
    }

    const triggerId = input.triggerId ?? null;
    if (triggerId !== null) {
      this.#validateLogTrigger(userId, habit, triggerId);
    } else if (input.replacementUsed === true) {
      throw validationError(
        "replacementUsed",
        "A substituição exige um gatilho vinculado",
      );
    }

    const value = input.value ?? (habit.habitType === "good" ? habit.dailyTarget : 1);
    const created = this.#repository.findLogByDate(habitId, input.logDate) === undefined;
    const now = new Date().toISOString();

    this.#repository.upsertLog({
      id: uuidv7(),
      habitId,
      logDate: input.logDate,
      value,
      note: normalizeText(input.note),
      triggerId,
      replacementUsed: input.replacementUsed ?? false,
      now,
    });

    const log = this.#repository.findLogByDate(habitId, input.logDate);
    if (!log) {
      throw new AppError("INTERNAL_ERROR", "Falha ao registrar o hábito");
    }

    this.#events?.publish({
      type: created ? "habit.log.created" : "habit.log.updated",
      aggregateType: "habit_log",
      aggregateId: log.id,
      userId,
      payload: {
        habitId,
        logId: log.id,
        logDate: log.logDate,
        value: log.value,
        habitType: habit.habitType,
        dailyTarget: habit.dailyTarget,
        replacementUsed: log.replacementUsed,
      },
    });

    return { log, created };
  }

  listLogs(userId: string, habitId: string, input: ListLogsInput): HabitLogPage {
    this.#requireHabit(userId, habitId);

    if (input.from !== undefined && input.to !== undefined && input.from > input.to) {
      throw validationError("from", "`from` não pode ser posterior a `to`");
    }

    const logs = this.#repository.listLogs(habitId, {
      from: input.from,
      to: input.to,
      limit: input.limit + 1,
      offset: input.offset,
    });

    return {
      logs: logs.slice(0, input.limit),
      hasMore: logs.length > input.limit,
    };
  }

  deleteLog(userId: string, habitId: string, logId: string): void {
    this.#requireHabit(userId, habitId);

    const log = this.#repository.findLogById(habitId, logId);
    if (!log) {
      throw new AppError("NOT_FOUND", "Registro não encontrado");
    }

    this.#repository.softDeleteLog(logId, new Date().toISOString());

    this.#events?.publish({
      type: "habit.log.deleted",
      aggregateType: "habit_log",
      aggregateId: logId,
      userId,
      payload: { habitId, logId, logDate: log.logDate },
    });
  }

  streak(userId: string, habitId: string, today: string = todayUtc()): HabitStreak {
    const habit = this.#requireHabit(userId, habitId);
    const logs = this.#repository.listAllLogs(habitId).map(toLogEntry);

    return computeHabitStreak(toSchedule(habit), logs, today);
  }

  calendar(
    userId: string,
    habitId: string,
    input: { readonly from?: string; readonly to?: string },
    today: string = todayUtc(),
  ): HabitCalendar {
    const habit = this.#requireHabit(userId, habitId);
    const bounds = monthBounds(today);
    const from = input.from ?? bounds.from;
    const to = input.to ?? bounds.to;

    if (from > to) {
      throw validationError("from", "`from` não pode ser posterior a `to`");
    }
    if (daysBetween(from, to) > MAX_CALENDAR_DAYS) {
      throw validationError("to", "O calendário aceita no máximo 366 dias");
    }

    const logs = this.#repository.listLogsInRange(habitId, from, to).map(toLogEntry);

    return {
      habitId,
      from,
      to,
      days: buildHabitCalendar(toSchedule(habit), logs, from, to, today),
    };
  }

  listTriggers(userId: string): HabitTrigger[] {
    return this.#repository.listTriggers(userId);
  }

  createTrigger(userId: string, input: CreateTriggerInput): HabitTrigger {
    const badHabit = this.#requireHabit(userId, input.badHabitId);
    this.#requireActiveHabitType(badHabit, "bad", "badHabitId");

    const replacementHabitId = input.replacementHabitId ?? null;
    if (replacementHabitId !== null) {
      const replacement = this.#requireHabit(userId, replacementHabitId);
      this.#requireActiveHabitType(replacement, "good", "replacementHabitId");
    }

    const triggerId = uuidv7();
    this.#repository.insertTrigger({
      id: triggerId,
      userId,
      badHabitId: badHabit.id,
      replacementHabitId,
      triggerDescription: input.triggerDescription.trim(),
      alternativeAction: normalizeText(input.alternativeAction),
      now: new Date().toISOString(),
    });

    return this.#requireTrigger(userId, triggerId);
  }

  updateTrigger(userId: string, triggerId: string, input: UpdateTriggerInput): HabitTrigger {
    const current = this.#requireTrigger(userId, triggerId);

    const replacementHabitId = input.replacementHabitId === undefined
      ? current.replacementHabitId
      : input.replacementHabitId;

    if (replacementHabitId !== null) {
      if (replacementHabitId === current.badHabitId) {
        throw validationError(
          "replacementHabitId",
          "O hábito de substituição precisa ser diferente do hábito ruim",
        );
      }
      const replacement = this.#requireHabit(userId, replacementHabitId);
      this.#requireActiveHabitType(replacement, "good", "replacementHabitId");
    }

    this.#repository.updateTrigger({
      id: triggerId,
      replacementHabitId,
      triggerDescription: input.triggerDescription === undefined
        ? current.triggerDescription
        : input.triggerDescription.trim(),
      alternativeAction: input.alternativeAction === undefined
        ? current.alternativeAction
        : normalizeText(input.alternativeAction),
      now: new Date().toISOString(),
    });

    return this.#requireTrigger(userId, triggerId);
  }

  deleteTrigger(userId: string, triggerId: string): void {
    this.#requireTrigger(userId, triggerId);
    this.#repository.softDeleteTrigger(triggerId, new Date().toISOString());
  }

  #requireHabit(userId: string, habitId: string): Habit {
    const habit = this.#repository.findById(userId, habitId);
    if (!habit) {
      throw new AppError("NOT_FOUND", "Hábito não encontrado");
    }
    return habit;
  }

  #requireActiveHabit(userId: string, habitId: string): Habit {
    const habit = this.#requireHabit(userId, habitId);
    if (!habit.isActive) {
      throw new AppError("CONFLICT", "O hábito está inativo");
    }
    return habit;
  }

  #requireTrigger(userId: string, triggerId: string): HabitTrigger {
    const trigger = this.#repository.findTriggerById(userId, triggerId);
    if (!trigger) {
      throw new AppError("NOT_FOUND", "Gatilho não encontrado");
    }
    return trigger;
  }

  #requireActiveHabitType(
    habit: Habit,
    type: HabitType,
    path: string,
  ): void {
    if (!habit.isActive) {
      throw validationError(path, "O hábito está inativo");
    }
    if (habit.habitType !== type) {
      throw validationError(
        path,
        type === "bad"
          ? "O gatilho precisa apontar para um hábito ruim"
          : "A substituição precisa apontar para um hábito bom",
      );
    }
  }

  /** Valida existência, tipo/atividade do pai, ciclos e profundidade. */
  #validateParent(userId: string, parentHabitId: string | null, habitId?: string): void {
    if (parentHabitId === null) return;

    if (habitId !== undefined && parentHabitId === habitId) {
      throw validationError("parentHabitId", "O hábito não pode ser pai de si mesmo");
    }

    const seen = new Set<string>();
    let cursor: string | null = parentHabitId;
    let depth = 0;

    while (cursor !== null) {
      if (habitId !== undefined && cursor === habitId) {
        throw validationError(
          "parentHabitId",
          "O vínculo criaria um ciclo entre hábitos",
        );
      }
      if (seen.has(cursor)) {
        throw validationError(
          "parentHabitId",
          "O vínculo criaria um ciclo entre hábitos",
        );
      }
      seen.add(cursor);

      const parent = this.#repository.findById(userId, cursor);
      if (!parent) {
        throw validationError("parentHabitId", "Hábito pai não encontrado");
      }
      if (!parent.isActive) {
        throw validationError("parentHabitId", "O hábito pai está inativo");
      }

      depth++;
      if (depth > MAX_HABIT_DEPTH) {
        throw validationError(
          "parentHabitId",
          `O empilhamento de hábitos é limitado a ${MAX_HABIT_DEPTH} níveis`,
        );
      }

      cursor = parent.parentHabitId;
    }
  }

  #validateLogTrigger(userId: string, habit: Habit, triggerId: string): void {
    const trigger = this.#requireTrigger(userId, triggerId);

    if (habit.habitType === "bad" && trigger.badHabitId !== habit.id) {
      throw validationError(
        "triggerId",
        "O gatilho não pertence a este hábito ruim",
      );
    }
    if (habit.habitType === "good" && trigger.replacementHabitId !== habit.id) {
      throw validationError(
        "triggerId",
        "O gatilho não aponta para este hábito de substituição",
      );
    }
  }

  #deactivateTree(userId: string, habitId: string, now: string): void {
    const ids = this.#repository.deactivateSubtree(userId, habitId, now);
    this.#repository.softDeleteTriggersForHabits(ids, now);
  }
}

function toSchedule(habit: Habit): HabitSchedule {
  return {
    habitType: habit.habitType,
    frequencyType: habit.frequencyType,
    daysOfWeek: habit.daysOfWeek,
    dailyTarget: habit.dailyTarget,
    startDate: habit.createdAt.slice(0, 10),
  };
}

function toLogEntry(log: HabitLog): HabitLogEntry {
  return {
    logDate: log.logDate,
    value: log.value,
    note: log.note,
    triggerId: log.triggerId,
    replacementUsed: log.replacementUsed,
  };
}

function normalizeDays(
  frequencyType: HabitFrequencyType,
  days: readonly number[],
): number[] {
  const unique = [...new Set(days)].sort((a, b) => a - b);

  if (unique.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
    throw validationError("daysOfWeek", "Use dias ISO entre 1 (segunda) e 7 (domingo)");
  }

  if (frequencyType === "daily" && unique.length > 0) {
    throw validationError("daysOfWeek", "Hábitos diários não usam dias da semana");
  }
  if (frequencyType === "weekly" && unique.length !== 1) {
    throw validationError("daysOfWeek", "Hábitos semanais exigem exatamente um dia");
  }
  if (frequencyType === "custom" && unique.length === 0) {
    throw validationError("daysOfWeek", "Hábitos personalizados exigem ao menos um dia");
  }

  return unique;
}

function normalizeText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeColor(value: string | null | undefined): string | null {
  const normalized = normalizeText(value);
  return normalized === null ? null : normalized.toLowerCase();
}

function validationError(path: string, message: string): AppError {
  return new AppError("VALIDATION_ERROR", "Dados inválidos", {
    details: [{ path, message }],
  });
}
