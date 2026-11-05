import type { AppDatabase } from "../db/client.ts";
import type { EventPublisher } from "../events/event-publisher.ts";
import { addDays, todayUtc } from "../shared/utils/date.ts";

/**
 * Padrões cross-domain calculados em SQL.
 *
 * A IA nunca recebe dados brutos para "descobrir" correlações: as métricas são
 * calculadas aqui, o padrão só é emitido quando há amostra suficiente e o LLM
 * se limita a transformar os números em linguagem natural.
 */
export interface CorrelationPattern {
  readonly type: string;
  readonly label: string;
  readonly period: { readonly from: string; readonly to: string };
  readonly confidence: number;
  readonly data: Record<string, unknown>;
}

/** Janela de análise e mínimo de dias em cada lado da comparação. */
const WINDOW_DAYS = 30;
const MIN_DAYS_PER_GROUP = 5;
const MIN_WEEKEND_DAYS = 4;
const MIN_DIFFERENCE_PERCENT = 20;

interface DailyExpenseRow {
  day: string;
  total: number;
}

interface CompletionRow {
  day: string;
}

/**
 * Detecta padrões determinísticos para o usuário. A função é pura em relação ao
 * banco: não grava nada e pode ser chamada pelo worker e pelo context builder.
 */
export function detectCorrelationPatterns(
  db: AppDatabase,
  userId: string,
  today: string = todayUtc(),
): CorrelationPattern[] {
  const from = addDays(today, -(WINDOW_DAYS - 1));
  const period = { from, to: today };

  const dailyExpenses = db
    .prepare<[string, string, string], DailyExpenseRow>(
      `SELECT t.transaction_date AS day, SUM(t.amount_minor) AS total
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE a.user_id = ? AND t.type = 'expense' AND t.deleted_at IS NULL
         AND t.transaction_date BETWEEN ? AND ?
       GROUP BY t.transaction_date
       ORDER BY t.transaction_date`,
    )
    .all(userId, from, today);

  if (dailyExpenses.length < MIN_DAYS_PER_GROUP) return [];

  const completedDays = new Set(
    db
      .prepare<[string, string, string], CompletionRow>(
        `SELECT DISTINCT hl.log_date AS day
         FROM habit_logs hl
         JOIN habits h ON h.id = hl.habit_id
         WHERE h.user_id = ? AND h.habit_type = 'good' AND h.is_active = 1
           AND hl.deleted_at IS NULL AND hl.value >= h.daily_target
           AND hl.log_date BETWEEN ? AND ?`,
      )
      .all(userId, from, today)
      .map((row) => row.day),
  );

  const patterns: CorrelationPattern[] = [];
  const habitSpending = detectHabitSpending(dailyExpenses, completedDays, period);
  if (habitSpending !== null) patterns.push(habitSpending);

  const weekend = detectWeekendSpending(dailyExpenses, period);
  if (weekend !== null) patterns.push(weekend);

  return patterns;
}

function detectHabitSpending(
  expenses: readonly DailyExpenseRow[],
  completedDays: ReadonlySet<string>,
  period: CorrelationPattern["period"],
): CorrelationPattern | null {
  const withHabit: number[] = [];
  const withoutHabit: number[] = [];

  for (const row of expenses) {
    (completedDays.has(row.day) ? withHabit : withoutHabit).push(row.total);
  }

  if (withHabit.length < MIN_DAYS_PER_GROUP || withoutHabit.length < MIN_DAYS_PER_GROUP) {
    return null;
  }

  const averageWithHabit = average(withHabit);
  const averageWithoutHabit = average(withoutHabit);
  if (averageWithoutHabit <= 0) return null;

  const differencePercent = Math.round(
    ((averageWithoutHabit - averageWithHabit) / averageWithoutHabit) * 100,
  );

  // Só interessa o caso em que o hábito está associado a MENOS gasto.
  if (differencePercent < MIN_DIFFERENCE_PERCENT) return null;

  const sampleFactor = Math.min(
    0.25,
    (withHabit.length + withoutHabit.length) / (WINDOW_DAYS * 4),
  );
  const confidence = clampConfidence(
    0.55 + Math.min(0.25, differencePercent / 400) + sampleFactor,
  );

  return {
    type: "habit_spending_link",
    label: "Hábitos concluídos e gasto diário",
    period,
    confidence,
    data: {
      completedDays: withHabit.length,
      otherDays: withoutHabit.length,
      averageSpentOnCompletedDaysMinor: averageWithHabit,
      averageSpentOnOtherDaysMinor: averageWithoutHabit,
      differencePercent,
    },
  };
}

function detectWeekendSpending(
  expenses: readonly DailyExpenseRow[],
  period: CorrelationPattern["period"],
): CorrelationPattern | null {
  const weekend: number[] = [];
  const weekday: number[] = [];

  for (const row of expenses) {
    const weekdayIndex = new Date(`${row.day}T00:00:00.000Z`).getUTCDay();
    (weekdayIndex === 0 || weekdayIndex === 6 ? weekend : weekday).push(row.total);
  }

  if (weekend.length < MIN_WEEKEND_DAYS || weekday.length < MIN_DAYS_PER_GROUP) {
    return null;
  }

  const averageWeekend = average(weekend);
  const averageWeekday = average(weekday);
  if (averageWeekday <= 0) return null;

  const differencePercent = Math.round(
    ((averageWeekend - averageWeekday) / averageWeekday) * 100,
  );
  if (differencePercent < MIN_DIFFERENCE_PERCENT * 1.25) return null;

  return {
    type: "weekend_spending_peak",
    label: "Gasto concentrado nos fins de semana",
    period,
    confidence: clampConfidence(0.55 + Math.min(0.3, differencePercent / 300)),
    data: {
      weekendDays: weekend.length,
      weekdays: weekday.length,
      averageWeekendSpentMinor: averageWeekend,
      averageWeekdaySpentMinor: averageWeekday,
      differencePercent,
    },
  };
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

function clampConfidence(value: number): number {
  return Math.min(1, Math.max(0, Math.round(value * 100) / 100));
}

interface CorrelationStateRow {
  last_run_at: string | null;
}

/**
 * A correlação é disparada por volume, não a cada evento: consultar todos os
 * dados a cada transação seria caro e geraria ruído. `last_run_at` funciona
 * como janela incremental.
 */
export function correlationIsDue(
  db: AppDatabase,
  userId: string,
  threshold: number,
): boolean {
  const state = db
    .prepare<[string], CorrelationStateRow>(
      "SELECT last_run_at FROM ai_correlation_state WHERE user_id = ?",
    )
    .get(userId);

  const since = state?.last_run_at ?? null;
  const row = since === null
    ? db
      .prepare<[string], { count: number }>(
        `SELECT COUNT(*) AS count FROM event_outbox
         WHERE user_id = ? AND status = 'completed'
           AND type NOT IN ('correlation.check', 'embedding.requested')`,
      )
      .get(userId)
    : db
      .prepare<[string, string], { count: number }>(
        `SELECT COUNT(*) AS count FROM event_outbox
         WHERE user_id = ? AND status = 'completed' AND processed_at > ?
           AND type NOT IN ('correlation.check', 'embedding.requested')`,
      )
      .get(userId, since);

  return (row?.count ?? 0) >= threshold;
}

export function markCorrelationRun(
  db: AppDatabase,
  userId: string,
  now: string,
): void {
  db
    .prepare<[string, string, string, string]>(
      `INSERT INTO ai_correlation_state (user_id, last_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         last_run_at = excluded.last_run_at,
         updated_at = excluded.updated_at`,
    )
    .run(userId, now, now, now);
}

export interface CorrelationSchedulerDependencies {
  readonly db: AppDatabase;
  readonly publisher: EventPublisher;
  readonly threshold: number;
  readonly now?: () => Date;
}

/**
 * Agenda um evento `correlation.check` por padrão detectado. Cada padrão é
 * isolado para que uma falha de prompt não impeça a análise dos demais.
 */
export class CorrelationScheduler {
  readonly #db: AppDatabase;
  readonly #publisher: EventPublisher;
  readonly #threshold: number;
  readonly #now: () => Date;

  constructor(dependencies: CorrelationSchedulerDependencies) {
    this.#db = dependencies.db;
    this.#publisher = dependencies.publisher;
    this.#threshold = dependencies.threshold;
    this.#now = dependencies.now ?? (() => new Date());
  }

  maybeSchedule(userId: string): number {
    const nowIso = this.#now().toISOString();
    if (!correlationIsDue(this.#db, userId, this.#threshold)) return 0;

    const today = todayUtc(this.#now());
    const patterns = detectCorrelationPatterns(this.#db, userId, today);
    let scheduled = 0;

    for (const pattern of patterns) {
      const id = this.#publisher.publish({
        type: "correlation.check",
        aggregateType: "user",
        aggregateId: userId,
        userId,
        payload: { patternType: pattern.type },
        priority: -1,
        availableAt: nowIso,
      });
      if (id !== null) scheduled++;
    }

    // Marca a execução mesmo sem padrões: evita reavaliar a cada evento.
    markCorrelationRun(this.#db, userId, nowIso);
    return scheduled;
  }
}
