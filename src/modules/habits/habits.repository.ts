import type { AppDatabase } from "../../db/client.ts";

export const HABIT_TYPES = ["good", "bad"] as const;
export type HabitType = (typeof HABIT_TYPES)[number];

export const HABIT_FREQUENCY_TYPES = ["daily", "weekly", "custom"] as const;
export type HabitFrequencyType = (typeof HABIT_FREQUENCY_TYPES)[number];

export interface Habit {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly description: string | null;
  readonly color: string | null;
  readonly habitType: HabitType;
  readonly frequencyType: HabitFrequencyType;
  readonly daysOfWeek: number[];
  readonly dailyTarget: number;
  readonly targetUnit: string | null;
  readonly orderIndex: number;
  readonly parentHabitId: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface HabitRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  color: string | null;
  habit_type: HabitType;
  frequency_type: HabitFrequencyType;
  days_of_week: string | null;
  daily_target: number;
  target_unit: string | null;
  order_index: number;
  parent_habit_id: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CreateHabitRecord {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly description: string | null;
  readonly color: string | null;
  readonly habitType: HabitType;
  readonly frequencyType: HabitFrequencyType;
  readonly daysOfWeek: readonly number[];
  readonly dailyTarget: number;
  readonly targetUnit: string | null;
  readonly orderIndex: number;
  readonly parentHabitId: string | null;
  readonly now: string;
}

export interface UpdateHabitRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly color: string | null;
  readonly habitType: HabitType;
  readonly frequencyType: HabitFrequencyType;
  readonly daysOfWeek: readonly number[];
  readonly dailyTarget: number;
  readonly targetUnit: string | null;
  readonly orderIndex: number;
  readonly parentHabitId: string | null;
  readonly isActive: boolean;
  readonly now: string;
}

export interface HabitLog {
  readonly id: string;
  readonly habitId: string;
  readonly logDate: string;
  readonly value: number;
  readonly note: string | null;
  readonly triggerId: string | null;
  readonly replacementUsed: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface HabitLogRow {
  id: string;
  habit_id: string;
  log_date: string;
  value: number;
  note: string | null;
  trigger_id: string | null;
  replacement_used: number;
  created_at: string;
  updated_at: string;
}

export interface HabitTrigger {
  readonly id: string;
  readonly userId: string;
  readonly badHabitId: string;
  readonly badHabitName: string;
  readonly replacementHabitId: string | null;
  readonly replacementHabitName: string | null;
  readonly triggerDescription: string;
  readonly alternativeAction: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface HabitTriggerRow {
  id: string;
  user_id: string;
  bad_habit_id: string;
  replacement_habit_id: string | null;
  trigger_description: string;
  alternative_action: string | null;
  created_at: string;
  updated_at: string;
  bad_habit_name: string;
  replacement_habit_name: string | null;
}

export interface CreateHabitLogRecord {
  readonly id: string;
  readonly habitId: string;
  readonly logDate: string;
  readonly value: number;
  readonly note: string | null;
  readonly triggerId: string | null;
  readonly replacementUsed: boolean;
  readonly now: string;
}

export interface CreateTriggerRecord {
  readonly id: string;
  readonly userId: string;
  readonly badHabitId: string;
  readonly replacementHabitId: string | null;
  readonly triggerDescription: string;
  readonly alternativeAction: string | null;
  readonly now: string;
}

export interface UpdateTriggerRecord {
  readonly id: string;
  readonly replacementHabitId: string | null;
  readonly triggerDescription: string;
  readonly alternativeAction: string | null;
  readonly now: string;
}

export interface ListHabitsOptions {
  readonly includeInactive?: boolean;
  readonly parentHabitId?: string | null;
  readonly habitType?: HabitType;
}

export interface ListLogsFilter {
  readonly from?: string;
  readonly to?: string;
  readonly limit: number;
  readonly offset: number;
}

const SELECT_TRIGGER = `
  SELECT t.*, bad.name AS bad_habit_name, replacement.name AS replacement_habit_name
  FROM habit_triggers t
  JOIN habits bad ON bad.id = t.bad_habit_id
  LEFT JOIN habits replacement ON replacement.id = t.replacement_habit_id
`;

/** Acesso a hábitos, logs e gatilhos, sempre escopado pelo usuário. */
export class HabitsRepository {
  constructor(private readonly db: AppDatabase) {}

  list(userId: string, options: ListHabitsOptions = {}): Habit[] {
    const params: unknown[] = [userId];
    let sql = "SELECT * FROM habits WHERE user_id = ?";

    if (options.includeInactive !== true) {
      sql += " AND is_active = 1";
    }
    if (options.habitType !== undefined) {
      sql += " AND habit_type = ?";
      params.push(options.habitType);
    }
    if (options.parentHabitId !== undefined) {
      if (options.parentHabitId === null) {
        sql += " AND parent_habit_id IS NULL";
      } else {
        sql += " AND parent_habit_id = ?";
        params.push(options.parentHabitId);
      }
    }

    sql += " ORDER BY order_index ASC, name COLLATE NOCASE ASC, created_at ASC";

    return this.db
      .prepare<unknown[], HabitRow>(sql)
      .all(...params)
      .map(mapHabit);
  }

  findById(userId: string, habitId: string): Habit | undefined {
    const row = this.db
      .prepare<[string, string], HabitRow>(
        "SELECT * FROM habits WHERE id = ? AND user_id = ?",
      )
      .get(habitId, userId);
    return row ? mapHabit(row) : undefined;
  }

  findActiveById(userId: string, habitId: string): Habit | undefined {
    const row = this.db
      .prepare<[string, string], HabitRow>(
        "SELECT * FROM habits WHERE id = ? AND user_id = ? AND is_active = 1",
      )
      .get(habitId, userId);
    return row ? mapHabit(row) : undefined;
  }

  create(record: CreateHabitRecord): void {
    this.db
      .prepare<
        [
          string,
          string,
          string,
          string | null,
          string | null,
          HabitType,
          HabitFrequencyType,
          string | null,
          number,
          string | null,
          number,
          string | null,
          string,
          string,
        ]
      >(
        `INSERT INTO habits
           (id, user_id, name, description, color, habit_type, frequency_type,
            days_of_week, daily_target, target_unit, order_index, parent_habit_id,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.userId,
        record.name,
        record.description,
        record.color,
        record.habitType,
        record.frequencyType,
        serializeDays(record.frequencyType, record.daysOfWeek),
        record.dailyTarget,
        record.targetUnit,
        record.orderIndex,
        record.parentHabitId,
        record.now,
        record.now,
      );
  }

  update(record: UpdateHabitRecord): void {
    this.db
      .prepare<
        [
          string,
          string | null,
          string | null,
          HabitType,
          HabitFrequencyType,
          string | null,
          number,
          string | null,
          number,
          string | null,
          number,
          string,
          string,
        ]
      >(
        `UPDATE habits
         SET name = ?, description = ?, color = ?, habit_type = ?, frequency_type = ?,
             days_of_week = ?, daily_target = ?, target_unit = ?, order_index = ?,
             parent_habit_id = ?, is_active = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        record.name,
        record.description,
        record.color,
        record.habitType,
        record.frequencyType,
        serializeDays(record.frequencyType, record.daysOfWeek),
        record.dailyTarget,
        record.targetUnit,
        record.orderIndex,
        record.parentHabitId,
        record.isActive ? 1 : 0,
        record.now,
        record.id,
      );
  }

  setActive(habitId: string, isActive: boolean, now: string): void {
    this.db
      .prepare<[number, string, string]>(
        "UPDATE habits SET is_active = ?, updated_at = ? WHERE id = ?",
      )
      .run(isActive ? 1 : 0, now, habitId);
  }

  updateOrderIndex(habitId: string, orderIndex: number, now: string): void {
    this.db
      .prepare<[number, string, string]>(
        "UPDATE habits SET order_index = ?, updated_at = ? WHERE id = ?",
      )
      .run(orderIndex, now, habitId);
  }

  nextOrderIndex(userId: string): number {
    const row = this.db
      .prepare<[string], { next: number }>(
        `SELECT COALESCE(MAX(order_index), -1) + 1 AS next
         FROM habits WHERE user_id = ?`,
      )
      .get(userId);
    return row?.next ?? 0;
  }

  /** IDs do hábito e de todos os descendentes (empilhamento). */
  descendantIds(userId: string, habitId: string): string[] {
    return this.db
      .prepare<[string, string, string], { id: string }>(
        `WITH RECURSIVE subtree(id) AS (
           SELECT id FROM habits WHERE id = ? AND user_id = ?
           UNION
           SELECT h.id FROM habits h
           JOIN subtree s ON h.parent_habit_id = s.id
           WHERE h.user_id = ?
         )
         SELECT id FROM subtree`,
      )
      .all(habitId, userId, userId)
      .map((row) => row.id);
  }

  deactivateSubtree(userId: string, habitId: string, now: string): string[] {
    const ids = this.descendantIds(userId, habitId);
    const update = this.db.prepare<[string, string]>(
      "UPDATE habits SET is_active = 0, updated_at = ? WHERE id = ?",
    );

    for (const id of ids) {
      update.run(now, id);
    }

    return ids;
  }

  hasLogs(habitId: string): boolean {
    const row = this.db
      .prepare<[string], { found: number }>(
        `SELECT EXISTS(
           SELECT 1 FROM habit_logs WHERE habit_id = ? AND deleted_at IS NULL
         ) AS found`,
      )
      .get(habitId);
    return row?.found === 1;
  }

  findLogByDate(habitId: string, logDate: string): HabitLog | undefined {
    const row = this.db
      .prepare<[string, string], HabitLogRow>(
        `SELECT * FROM habit_logs
         WHERE habit_id = ? AND log_date = ? AND deleted_at IS NULL`,
      )
      .get(habitId, logDate);
    return row ? mapLog(row) : undefined;
  }

  /** Inclui logs removidos para decidir entre criar/restaurar no upsert. */
  findLogByDateIncludingDeleted(habitId: string, logDate: string): HabitLog | undefined {
    const row = this.db
      .prepare<[string, string], HabitLogRow>(
        "SELECT * FROM habit_logs WHERE habit_id = ? AND log_date = ?",
      )
      .get(habitId, logDate);
    return row ? mapLog(row) : undefined;
  }

  findLogById(habitId: string, logId: string): HabitLog | undefined {
    const row = this.db
      .prepare<[string, string], HabitLogRow>(
        `SELECT * FROM habit_logs
         WHERE id = ? AND habit_id = ? AND deleted_at IS NULL`,
      )
      .get(logId, habitId);
    return row ? mapLog(row) : undefined;
  }

  listLogs(habitId: string, filter: ListLogsFilter): HabitLog[] {
    const params: unknown[] = [habitId];
    let sql = "SELECT * FROM habit_logs WHERE habit_id = ? AND deleted_at IS NULL";

    if (filter.from !== undefined) {
      sql += " AND log_date >= ?";
      params.push(filter.from);
    }
    if (filter.to !== undefined) {
      sql += " AND log_date <= ?";
      params.push(filter.to);
    }

    sql += " ORDER BY log_date DESC, created_at DESC LIMIT ? OFFSET ?";
    params.push(filter.limit, filter.offset);

    return this.db
      .prepare<unknown[], HabitLogRow>(sql)
      .all(...params)
      .map(mapLog);
  }

  listLogsInRange(habitId: string, from: string, to: string): HabitLog[] {
    return this.db
      .prepare<[string, string, string], HabitLogRow>(
        `SELECT * FROM habit_logs
         WHERE habit_id = ? AND log_date BETWEEN ? AND ? AND deleted_at IS NULL
         ORDER BY log_date ASC`,
      )
      .all(habitId, from, to)
      .map(mapLog);
  }

  listAllLogs(habitId: string): HabitLog[] {
    return this.db
      .prepare<[string], HabitLogRow>(
        `SELECT * FROM habit_logs
         WHERE habit_id = ? AND deleted_at IS NULL
         ORDER BY log_date ASC`,
      )
      .all(habitId)
      .map(mapLog);
  }

  /**
   * Cria ou restaura o log do dia. O `ON CONFLICT` mantém a unicidade
   * `(habit_id, log_date)` e reativa uma linha previamente removida.
   */
  upsertLog(record: CreateHabitLogRecord): void {
    this.db
      .prepare<
        [string, string, string, number, string | null, string | null, number, string, string]
      >(
        `INSERT INTO habit_logs
           (id, habit_id, log_date, value, note, trigger_id, replacement_used,
            deleted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT (habit_id, log_date) DO UPDATE SET
           value = excluded.value,
           note = excluded.note,
           trigger_id = excluded.trigger_id,
           replacement_used = excluded.replacement_used,
           deleted_at = NULL,
           updated_at = excluded.updated_at`,
      )
      .run(
        record.id,
        record.habitId,
        record.logDate,
        record.value,
        record.note,
        record.triggerId,
        record.replacementUsed ? 1 : 0,
        record.now,
        record.now,
      );
  }

  softDeleteLog(logId: string, now: string): void {
    this.db
      .prepare<[string, string, string]>(
        `UPDATE habit_logs SET deleted_at = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(now, now, logId);
  }

  listTriggers(userId: string): HabitTrigger[] {
    return this.db
      .prepare<[string], HabitTriggerRow>(
        `${SELECT_TRIGGER}
         WHERE t.user_id = ? AND t.deleted_at IS NULL
         ORDER BY t.created_at ASC, t.id ASC`,
      )
      .all(userId)
      .map(mapTrigger);
  }

  findTriggerById(userId: string, triggerId: string): HabitTrigger | undefined {
    const row = this.db
      .prepare<[string, string], HabitTriggerRow>(
        `${SELECT_TRIGGER}
         WHERE t.id = ? AND t.user_id = ? AND t.deleted_at IS NULL`,
      )
      .get(triggerId, userId);
    return row ? mapTrigger(row) : undefined;
  }

  insertTrigger(record: CreateTriggerRecord): void {
    this.db
      .prepare<
        [string, string, string, string | null, string, string | null, string, string]
      >(
        `INSERT INTO habit_triggers
           (id, user_id, bad_habit_id, replacement_habit_id, trigger_description,
            alternative_action, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.userId,
        record.badHabitId,
        record.replacementHabitId,
        record.triggerDescription,
        record.alternativeAction,
        record.now,
        record.now,
      );
  }

  updateTrigger(record: UpdateTriggerRecord): void {
    this.db
      .prepare<[string | null, string, string | null, string, string]>(
        `UPDATE habit_triggers
         SET replacement_habit_id = ?, trigger_description = ?,
             alternative_action = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        record.replacementHabitId,
        record.triggerDescription,
        record.alternativeAction,
        record.now,
        record.id,
      );
  }

  softDeleteTrigger(triggerId: string, now: string): void {
    this.db
      .prepare<[string, string, string]>(
        `UPDATE habit_triggers SET deleted_at = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(now, now, triggerId);
  }

  /** Remove gatilhos que apontam para hábitos desativados em cascata. */
  softDeleteTriggersForHabits(habitIds: readonly string[], now: string): void {
    if (habitIds.length === 0) return;

    const placeholders = habitIds.map(() => "?").join(", ");
    this.db
      .prepare<unknown[]>(
        `UPDATE habit_triggers
         SET deleted_at = ?, updated_at = ?
         WHERE deleted_at IS NULL
           AND (bad_habit_id IN (${placeholders}) OR replacement_habit_id IN (${placeholders}))`,
      )
      .run(now, now, ...habitIds, ...habitIds);
  }
}

function serializeDays(
  frequencyType: HabitFrequencyType,
  daysOfWeek: readonly number[],
): string | null {
  return frequencyType === "daily" ? null : JSON.stringify(daysOfWeek);
}

function parseDays(value: string | null): number[] {
  if (value === null) return [];

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is number => typeof entry === "number");
  } catch {
    return [];
  }
}

function mapHabit(row: HabitRow): Habit {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    color: row.color,
    habitType: row.habit_type,
    frequencyType: row.frequency_type,
    daysOfWeek: parseDays(row.days_of_week),
    dailyTarget: row.daily_target,
    targetUnit: row.target_unit,
    orderIndex: row.order_index,
    parentHabitId: row.parent_habit_id,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLog(row: HabitLogRow): HabitLog {
  return {
    id: row.id,
    habitId: row.habit_id,
    logDate: row.log_date,
    value: row.value,
    note: row.note,
    triggerId: row.trigger_id,
    replacementUsed: row.replacement_used === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTrigger(row: HabitTriggerRow): HabitTrigger {
  return {
    id: row.id,
    userId: row.user_id,
    badHabitId: row.bad_habit_id,
    badHabitName: row.bad_habit_name,
    replacementHabitId: row.replacement_habit_id,
    replacementHabitName: row.replacement_habit_name,
    triggerDescription: row.trigger_description,
    alternativeAction: row.alternative_action,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
