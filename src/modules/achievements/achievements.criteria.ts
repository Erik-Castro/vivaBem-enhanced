import type { AppDatabase } from "../../db/client.ts";

/**
 * DSL declarativa de critérios de conquistas.
 *
 * O motor é genérico: cada conquista referencia um dataset e uma métrica
 * (`count`, `sum`, `distinct`, `streak`, ...). Nenhuma regra de negócio do
 * catálogo vira SQL solto no service; o SQL é montado a partir de uma lista
 * fechada de datasets e operadores.
 */

export type CompareOp =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "notLike"
  | "isNull"
  | "notNull"
  | "notEmpty";

export type FnName =
  | "today"
  | "thisMonth"
  | "nowDay"
  | "nowHour"
  | "nowMinute"
  | "nowWeekday"
  | "sevenDaysAgo";

export type Operand =
  | { readonly column: string }
  | { readonly value: string | number | null }
  | { readonly fn: FnName };

export type Condition =
  | { readonly all: readonly Condition[] }
  | { readonly any: readonly Condition[] }
  | { readonly left: Operand; readonly op: CompareOp; readonly right?: Operand };

export type DatasetName =
  | "transactions"
  | "transactionsCard"
  | "transactionsCardDetails"
  | "transactionsMonthly"
  | "transactionsCardMonthly"
  | "habits"
  | "habitsLength"
  | "habitLogs"
  | "habitLogsHourly"
  | "habitLogsWeekday"
  | "accounts"
  | "creditCardDetails"
  | "categories"
  | "investments"
  | "investmentTransactions"
  | "investmentTransactionValues"
  | "investmentSells"
  | "sessions"
  | "sessionDays"
  | "profiles"
  | "credentials"
  | "preferences"
  | "triggers"
  | "recurringOccurrences"
  | "userAchievements";

export type StreakUnit = "day" | "businessDay" | "week" | "month";

export type CriteriaSpec =
  | {
    readonly kind: "count";
    readonly dataset: DatasetName;
    readonly where?: readonly Condition[];
    readonly distinctField?: string;
  }
  | {
    readonly kind: "exists";
    readonly dataset: DatasetName;
    readonly where?: readonly Condition[];
  }
  | {
    readonly kind: "sum";
    readonly dataset: DatasetName;
    readonly field: string;
    readonly where?: readonly Condition[];
  }
  | {
    readonly kind: "max";
    readonly dataset: DatasetName;
    readonly field: string;
    readonly where?: readonly Condition[];
  }
  | {
    readonly kind: "maxGroup";
    readonly dataset: DatasetName;
    readonly field: string;
    readonly where?: readonly Condition[];
  }
  | {
    readonly kind: "maxGroupDays";
    readonly dataset: DatasetName;
    readonly groupBy: string;
    readonly dateField: string;
    readonly where?: readonly Condition[];
  }
  | {
    readonly kind: "streak";
    readonly dataset: DatasetName;
    readonly dateField: string;
    readonly unit: StreakUnit;
    readonly where?: readonly Condition[];
  }
  | {
    readonly kind: "maxGroupStreak";
    readonly dataset: DatasetName;
    readonly groupBy: string;
    readonly dateField: string;
    readonly unit: StreakUnit;
    readonly where?: readonly Condition[];
  }
  | {
    readonly kind: "rowStreak";
    readonly dataset: DatasetName;
    readonly orderBy: readonly string[];
    readonly where?: readonly Condition[];
  }
  | {
    readonly kind: "sameValueStreak";
    readonly dataset: DatasetName;
    readonly field: string;
    readonly orderBy: readonly string[];
    readonly where?: readonly Condition[];
  }
  | {
    readonly kind: "daysSince";
    readonly dataset: DatasetName;
    readonly dateField: string;
    readonly aggregate: "min" | "max";
    readonly where?: readonly Condition[];
    readonly emptyValue?: number;
    readonly offset?: number;
  }
  | {
    readonly kind: "ratioPredicate";
    readonly numerator: CriteriaSpec;
    readonly denominator: CriteriaSpec;
    readonly op: CompareOp;
    readonly value: number;
    readonly emptyValue?: number;
  }
  | {
    readonly kind: "maxRatioPredicate";
    readonly dataset: DatasetName;
    readonly leftField: string;
    readonly rightField: string;
    readonly where?: readonly Condition[];
    readonly op: CompareOp;
    readonly value: number;
  }
  | {
    readonly kind: "uniform";
    readonly dataset: DatasetName;
    readonly field: string;
    readonly minRows: number;
    readonly where?: readonly Condition[];
  }
  | {
    readonly kind: "conditional";
    readonly when: CriteriaSpec;
    readonly op: CompareOp;
    readonly value: number;
    readonly then: CriteriaSpec;
    readonly otherwise?: CriteriaSpec;
  }
  | {
    readonly kind: "allOf";
    readonly checks: readonly {
      readonly spec: CriteriaSpec;
      readonly op: CompareOp;
      readonly value: number;
    }[];
  }
  | {
    readonly kind: "score";
    readonly components: readonly {
      readonly spec: CriteriaSpec;
      readonly op: CompareOp;
      readonly value: number;
      readonly points: number;
    }[];
  }
  | { readonly kind: "constant"; readonly value: number };

export interface EvaluationContext {
  readonly db: AppDatabase;
  readonly userId: string;
  /** Injetável para testes; nunca use `new Date()` dentro do motor. */
  readonly now: Date;
}

interface DatasetDefinition {
  readonly from: string;
  readonly userColumn: string;
  readonly baseWhere: readonly string[];
}

export const DATASETS: Record<DatasetName, DatasetDefinition> = {
  transactions: {
    from: "transactions t JOIN accounts a ON t.account_id = a.id",
    userColumn: "a.user_id",
    baseWhere: ["t.deleted_at IS NULL"],
  },
  transactionsCard: {
    from: "transactions t JOIN accounts a ON t.account_id = a.id " +
      "JOIN credit_card_transactions cct ON cct.transaction_id = t.id",
    userColumn: "a.user_id",
    baseWhere: ["t.deleted_at IS NULL"],
  },
  transactionsCardDetails: {
    from: "transactions t JOIN accounts a ON t.account_id = a.id " +
      "JOIN credit_card_details ccd ON ccd.account_id = a.id",
    userColumn: "a.user_id",
    baseWhere: ["t.deleted_at IS NULL"],
  },
  transactionsMonthly: {
    from: "(SELECT t.*, substr(t.transaction_date, 1, 7) AS month FROM transactions t) t " +
      "JOIN accounts a ON t.account_id = a.id",
    userColumn: "a.user_id",
    baseWhere: ["t.deleted_at IS NULL"],
  },
  transactionsCardMonthly: {
    from: "(SELECT t.*, substr(t.transaction_date, 1, 7) AS month FROM transactions t) t " +
      "JOIN accounts a ON t.account_id = a.id " +
      "JOIN credit_card_transactions cct ON cct.transaction_id = t.id",
    userColumn: "a.user_id",
    baseWhere: ["t.deleted_at IS NULL"],
  },
  habits: {
    from: "habits h",
    userColumn: "h.user_id",
    baseWhere: ["1 = 1"],
  },
  habitsLength: {
    from: "(SELECT h.*, length(h.name) AS name_length, " +
      "length(h.description) AS description_length, substr(h.updated_at, 1, 10) AS updated_day " +
      "FROM habits h) h",
    userColumn: "h.user_id",
    baseWhere: ["1 = 1"],
  },
  habitLogs: {
    from: "habit_logs hl JOIN habits h ON hl.habit_id = h.id",
    userColumn: "h.user_id",
    baseWhere: ["hl.deleted_at IS NULL"],
  },
  habitLogsHourly: {
    from: "(SELECT hl.*, substr(hl.created_at, 12, 2) AS log_hour FROM habit_logs hl) hl " +
      "JOIN habits h ON hl.habit_id = h.id",
    userColumn: "h.user_id",
    baseWhere: ["hl.deleted_at IS NULL"],
  },
  habitLogsWeekday: {
    from: "(SELECT hl.*, CAST(strftime('%w', hl.log_date) AS INTEGER) AS weekday " +
      "FROM habit_logs hl) hl JOIN habits h ON hl.habit_id = h.id",
    userColumn: "h.user_id",
    baseWhere: ["hl.deleted_at IS NULL"],
  },
  accounts: {
    from: "accounts a",
    userColumn: "a.user_id",
    baseWhere: ["1 = 1"],
  },
  creditCardDetails: {
    from: "credit_card_details ccd JOIN accounts a ON ccd.account_id = a.id",
    userColumn: "a.user_id",
    baseWhere: ["1 = 1"],
  },
  categories: {
    from: "categories c",
    userColumn: "c.user_id",
    baseWhere: ["1 = 1"],
  },
  investments: {
    from: "investments i",
    userColumn: "i.user_id",
    baseWhere: ["i.deleted_at IS NULL"],
  },
  investmentTransactions: {
    from: "investment_transactions it JOIN investments i ON it.investment_id = i.id",
    userColumn: "i.user_id",
    baseWhere: ["i.deleted_at IS NULL"],
  },
  investmentTransactionValues: {
    from: "(SELECT it.*, it.quantity * it.unit_price_minor AS gross_minor " +
      "FROM investment_transactions it) it JOIN investments i ON it.investment_id = i.id",
    userColumn: "i.user_id",
    baseWhere: ["i.deleted_at IS NULL"],
  },
  // A subquery resolve o "último buy anterior" para a regra de venda no curto
  // prazo sem precisar de um avaliador bespoke.
  investmentSells: {
    from: "(SELECT it.id, i.user_id, it.operation_date AS sell_date, " +
      "CAST(julianday(it.operation_date) - julianday((" +
      "SELECT MAX(it2.operation_date) FROM investment_transactions it2 " +
      "WHERE it2.investment_id = it.investment_id AND it2.operation_type = 'buy' " +
      "AND (it2.operation_date < it.operation_date " +
      "OR (it2.operation_date = it.operation_date AND " +
      "(it2.created_at < it.created_at OR (it2.created_at = it.created_at " +
      "AND it2.rowid < it.rowid)))))) AS INTEGER) AS days_held " +
      "FROM investment_transactions it JOIN investments i ON it.investment_id = i.id " +
      "WHERE it.operation_type = 'sell') it",
    userColumn: "it.user_id",
    baseWhere: ["1 = 1"],
  },
  sessions: {
    from: "user_sessions s",
    userColumn: "s.user_id",
    baseWhere: ["1 = 1"],
  },
  sessionDays: {
    from: "(SELECT user_id, substr(created_at, 1, 10) AS session_date, ip_address " +
      "FROM user_sessions) s",
    userColumn: "s.user_id",
    baseWhere: ["1 = 1"],
  },
  profiles: {
    from: "user_profiles p",
    userColumn: "p.id",
    baseWhere: ["1 = 1"],
  },
  credentials: {
    from: "user_credentials uc",
    userColumn: "uc.user_id",
    baseWhere: ["1 = 1"],
  },
  preferences: {
    from: "user_preferences pref",
    userColumn: "pref.user_id",
    baseWhere: ["1 = 1"],
  },
  triggers: {
    from: "habit_triggers ht",
    userColumn: "ht.user_id",
    baseWhere: ["ht.deleted_at IS NULL"],
  },
  recurringOccurrences: {
    from: "recurring_occurrences ro JOIN recurring_transactions r " +
      "ON ro.recurring_transaction_id = r.id",
    userColumn: "r.user_id",
    baseWhere: ["1 = 1"],
  },
  userAchievements: {
    from: "user_achievements ua",
    userColumn: "ua.user_id",
    baseWhere: ["ua.is_unlocked = 1"],
  },
};

const SQL_OPERATORS: Record<Exclude<CompareOp, "isNull" | "notNull" | "notEmpty">, string> = {
  eq: "=",
  ne: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  like: "LIKE",
  notLike: "NOT LIKE",
};

const COLUMN_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const ORDER_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*(?: (?:ASC|DESC))?$/;

function assertColumn(column: string): string {
  if (!COLUMN_PATTERN.test(column)) {
    throw new Error(`Coluna inválida no critério de conquista: ${column}`);
  }
  return column;
}

function assertOrder(entry: string): string {
  if (!ORDER_PATTERN.test(entry)) {
    throw new Error(`Ordenação inválida no critério de conquista: ${entry}`);
  }
  return entry;
}

function resolveFn(name: FnName, now: Date): string | number {
  switch (name) {
    case "today":
      return now.toISOString().slice(0, 10);
    case "thisMonth":
      return now.toISOString().slice(0, 7);
    case "nowDay":
      return now.getUTCDate();
    case "nowHour":
      return now.getUTCHours();
    case "nowMinute":
      return now.getUTCMinutes();
    case "nowWeekday":
      return now.getUTCDay();
    case "sevenDaysAgo":
      return new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  }
}

interface CompiledFragment {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function compileOperand(operand: Operand, now: Date): CompiledFragment {
  if ("column" in operand) {
    return { sql: assertColumn(operand.column), params: [] };
  }
  if ("fn" in operand) {
    return { sql: "?", params: [resolveFn(operand.fn, now)] };
  }
  return { sql: "?", params: [operand.value] };
}

function compileCondition(condition: Condition, now: Date): CompiledFragment {
  if ("all" in condition) {
    const parts = condition.all.map((entry) => compileCondition(entry, now));
    if (parts.length === 0) return { sql: "1 = 1", params: [] };
    return {
      sql: parts.map((part) => `(${part.sql})`).join(" AND "),
      params: parts.flatMap((part) => part.params),
    };
  }
  if ("any" in condition) {
    const parts = condition.any.map((entry) => compileCondition(entry, now));
    if (parts.length === 0) return { sql: "1 = 0", params: [] };
    return {
      sql: parts.map((part) => `(${part.sql})`).join(" OR "),
      params: parts.flatMap((part) => part.params),
    };
  }

  const left = compileOperand(condition.left, now);

  if (condition.op === "isNull") return { sql: `${left.sql} IS NULL`, params: left.params };
  if (condition.op === "notNull") return { sql: `${left.sql} IS NOT NULL`, params: left.params };
  if (condition.op === "notEmpty") {
    return {
      sql: `(${left.sql} IS NOT NULL AND ${left.sql} <> '')`,
      params: left.params,
    };
  }

  const right = compileOperand(condition.right ?? { value: null }, now);
  return {
    sql: `${left.sql} ${SQL_OPERATORS[condition.op]} ${right.sql}`,
    params: [...left.params, ...right.params],
  };
}

function compileWhere(
  where: readonly Condition[] | undefined,
  now: Date,
): CompiledFragment {
  if (where === undefined || where.length === 0) return { sql: "", params: [] };
  const parts = where.map((condition) => compileCondition(condition, now));
  return {
    sql: ` AND ${parts.map((part) => `(${part.sql})`).join(" AND ")}`,
    params: parts.flatMap((part) => part.params),
  };
}

interface CompiledSource {
  readonly from: string;
  readonly where: string;
  readonly params: readonly unknown[];
}

function compileSource(dataset: DatasetName, userId: string): CompiledSource {
  const definition = DATASETS[dataset];
  const clauses = [`${assertColumn(definition.userColumn)} = ?`, ...definition.baseWhere];
  return {
    from: `FROM ${definition.from}`,
    where: clauses.join(" AND "),
    params: [userId],
  };
}

function runValue(ctx: EvaluationContext, sql: string, params: readonly unknown[]): number {
  const row = ctx.db
    .prepare<unknown[], { value: number | null }>(sql)
    .get(...params);
  const value = row?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function compare(value: number, op: CompareOp, expected: number): boolean {
  switch (op) {
    case "eq":
      return value === expected;
    case "ne":
      return value !== expected;
    case "gt":
      return value > expected;
    case "gte":
      return value >= expected;
    case "lt":
      return value < expected;
    case "lte":
      return value <= expected;
    default:
      return false;
  }
}

function parseDate(value: string): Date | null {
  const normalized = value.length === 10 ? `${value}T00:00:00.000Z` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayNumber(date: Date): number {
  return Math.floor(date.getTime() / 86_400_000);
}

function businessDayNumber(date: Date): number {
  const day = dayNumber(date);
  // 1970-01-05 (day 4) foi uma segunda-feira. A partir dela, cada semana
  // completa contribui com 5 dias úteis e sábado/domingo herdam a sexta.
  const weeks = Math.floor((day - 4) / 7);
  const weekdayIndex = (date.getUTCDay() + 6) % 7; // segunda = 0 … domingo = 6
  return weeks * 5 + Math.min(weekdayIndex, 5);
}

function unitKey(date: Date, unit: StreakUnit): number {
  if (unit === "day") return dayNumber(date);
  if (unit === "businessDay") return businessDayNumber(date);
  if (unit === "week") return Math.floor((dayNumber(date) + 3) / 7);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

/**
 * Conta unidades consecutivas terminando na unidade atual ou na anterior.
 * A tolerância de uma unidade evita quebrar o streak antes de o dia/semana/mês
 * corrente terminar.
 */
function streakLength(keys: readonly number[], currentKey: number): number {
  const unique = [...new Set(keys)].sort((left, right) => right - left);
  const first = unique[0];
  if (first === undefined) return 0;

  let expected = first === currentKey - 1 ? first : currentKey;
  let streak = 0;

  for (const key of unique) {
    if (key > expected) continue;
    if (key !== expected) break;
    streak++;
    expected--;
  }

  return streak;
}

function daysBetween(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / 86_400_000));
}

export function evaluateCriteria(spec: CriteriaSpec, ctx: EvaluationContext): number {
  switch (spec.kind) {
    case "constant":
      return spec.value;

    case "count": {
      const source = compileSource(spec.dataset, ctx.userId);
      const where = compileWhere(spec.where, ctx.now);
      const target = spec.distinctField === undefined
        ? "*"
        : `DISTINCT ${assertColumn(spec.distinctField)}`;
      return Math.trunc(
        runValue(
          ctx,
          `SELECT COUNT(${target}) AS value ${source.from} WHERE ${source.where}${where.sql}`,
          [...source.params, ...where.params],
        ),
      );
    }

    case "exists": {
      const source = compileSource(spec.dataset, ctx.userId);
      const where = compileWhere(spec.where, ctx.now);
      return runValue(
        ctx,
        `SELECT CASE WHEN EXISTS (SELECT 1 ${source.from} WHERE ${source.where}${where.sql}) ` +
          "THEN 1 ELSE 0 END AS value",
        [...source.params, ...where.params],
      );
    }

    case "sum": {
      const source = compileSource(spec.dataset, ctx.userId);
      const where = compileWhere(spec.where, ctx.now);
      return Math.trunc(
        runValue(
          ctx,
          `SELECT COALESCE(SUM(${assertColumn(spec.field)}), 0) AS value ` +
            `${source.from} WHERE ${source.where}${where.sql}`,
          [...source.params, ...where.params],
        ),
      );
    }

    case "max": {
      const source = compileSource(spec.dataset, ctx.userId);
      const where = compileWhere(spec.where, ctx.now);
      return Math.trunc(
        runValue(
          ctx,
          `SELECT COALESCE(MAX(${assertColumn(spec.field)}), 0) AS value ` +
            `${source.from} WHERE ${source.where}${where.sql}`,
          [...source.params, ...where.params],
        ),
      );
    }

    case "maxGroup": {
      const source = compileSource(spec.dataset, ctx.userId);
      const where = compileWhere(spec.where, ctx.now);
      const field = assertColumn(spec.field);
      return Math.trunc(
        runValue(
          ctx,
          "SELECT COALESCE(MAX(cnt), 0) AS value FROM (" +
            `SELECT COUNT(*) AS cnt ${source.from} WHERE ${source.where}${where.sql} ` +
            `GROUP BY ${field})`,
          [...source.params, ...where.params],
        ),
      );
    }

    case "maxGroupDays": {
      const source = compileSource(spec.dataset, ctx.userId);
      const where = compileWhere(spec.where, ctx.now);
      const rows = ctx.db
        .prepare<unknown[], { g: unknown; d: string | null }>(
          `SELECT ${assertColumn(spec.groupBy)} AS g, MIN(${assertColumn(spec.dateField)}) AS d ` +
            `${source.from} WHERE ${source.where}${where.sql} GROUP BY ${
              assertColumn(spec.groupBy)
            }`,
        )
        .all(...source.params, ...where.params);

      let best = 0;
      for (const row of rows) {
        if (row.d === null) continue;
        const date = parseDate(row.d);
        if (date === null) continue;
        best = Math.max(best, daysBetween(date, ctx.now));
      }
      return best;
    }

    case "streak": {
      const source = compileSource(spec.dataset, ctx.userId);
      const where = compileWhere(spec.where, ctx.now);
      const rows = ctx.db
        .prepare<unknown[], { d: string }>(
          `SELECT DISTINCT ${assertColumn(spec.dateField)} AS d ${source.from} ` +
            `WHERE ${source.where}${where.sql} ORDER BY d DESC`,
        )
        .all(...source.params, ...where.params);

      const keys: number[] = [];
      for (const row of rows) {
        const date = parseDate(row.d);
        if (date !== null) keys.push(unitKey(date, spec.unit));
      }
      return streakLength(keys, unitKey(ctx.now, spec.unit));
    }

    case "maxGroupStreak": {
      const source = compileSource(spec.dataset, ctx.userId);
      const where = compileWhere(spec.where, ctx.now);
      const rows = ctx.db
        .prepare<unknown[], { g: unknown; d: string }>(
          `SELECT ${assertColumn(spec.groupBy)} AS g, ${assertColumn(spec.dateField)} AS d ` +
            `${source.from} WHERE ${source.where}${where.sql} ORDER BY d DESC`,
        )
        .all(...source.params, ...where.params);

      const groups = new Map<string, number[]>();
      for (const row of rows) {
        const date = parseDate(row.d);
        if (date === null) continue;
        const key = String(row.g);
        const bucket = groups.get(key) ?? [];
        bucket.push(unitKey(date, spec.unit));
        groups.set(key, bucket);
      }

      const currentKey = unitKey(ctx.now, spec.unit);
      let best = 0;
      for (const keys of groups.values()) {
        best = Math.max(best, streakLength(keys, currentKey));
      }
      return best;
    }

    case "rowStreak": {
      const source = compileSource(spec.dataset, ctx.userId);
      const order = spec.orderBy.map(assertOrder).join(", ");
      const match = compileWhere(spec.where, ctx.now);
      const condition = match.sql === "" ? "1 = 1" : match.sql.slice(" AND ".length);

      const rows = ctx.db
        .prepare<unknown[], { ok: number }>(
          `SELECT CASE WHEN ${condition} THEN 1 ELSE 0 END AS ok ${source.from} ` +
            `WHERE ${source.where} ORDER BY ${order}`,
        )
        .all(...match.params, ...source.params);

      let streak = 0;
      for (const row of rows) {
        if (row.ok !== 1) break;
        streak++;
      }
      return streak;
    }

    case "sameValueStreak": {
      const source = compileSource(spec.dataset, ctx.userId);
      const where = compileWhere(spec.where, ctx.now);
      const order = spec.orderBy.map(assertOrder).join(", ");
      const rows = ctx.db
        .prepare<unknown[], { v: string | number | null }>(
          `SELECT ${assertColumn(spec.field)} AS v ${source.from} ` +
            `WHERE ${source.where}${where.sql} ORDER BY ${order}`,
        )
        .all(...source.params, ...where.params);

      const first = rows[0];
      if (first === undefined || first.v === null) return 0;

      let streak = 0;
      for (const row of rows) {
        if (row.v !== first.v) break;
        streak++;
      }
      return streak;
    }

    case "daysSince": {
      const source = compileSource(spec.dataset, ctx.userId);
      const where = compileWhere(spec.where, ctx.now);
      const aggregate = spec.aggregate === "min" ? "MIN" : "MAX";
      const row = ctx.db
        .prepare<unknown[], { value: string | null }>(
          `SELECT ${aggregate}(${assertColumn(spec.dateField)}) AS value ` +
            `${source.from} WHERE ${source.where}${where.sql}`,
        )
        .get(...source.params, ...where.params);

      if (row?.value === null || row?.value === undefined) {
        return spec.emptyValue ?? 0;
      }
      const date = parseDate(row.value);
      return date === null
        ? (spec.emptyValue ?? 0)
        : daysBetween(date, ctx.now) + (spec.offset ?? 0);
    }

    case "ratioPredicate": {
      const numerator = evaluateCriteria(spec.numerator, ctx);
      const denominator = evaluateCriteria(spec.denominator, ctx);
      if (denominator === 0) {
        return compare(spec.emptyValue ?? 0, spec.op, spec.value) ? 1 : 0;
      }
      return compare(numerator / denominator, spec.op, spec.value) ? 1 : 0;
    }

    case "maxRatioPredicate": {
      const source = compileSource(spec.dataset, ctx.userId);
      const where = compileWhere(spec.where, ctx.now);
      const value = runValue(
        ctx,
        "SELECT COALESCE(MAX(CAST(" + assertColumn(spec.leftField) + " AS REAL) / " +
          `NULLIF(${assertColumn(spec.rightField)}, 0)), 0) AS value ` +
          `${source.from} WHERE ${source.where}${where.sql}`,
        [...source.params, ...where.params],
      );
      return compare(value, spec.op, spec.value) ? 1 : 0;
    }

    case "uniform": {
      const source = compileSource(spec.dataset, ctx.userId);
      const where = compileWhere(spec.where, ctx.now);
      const row = ctx.db
        .prepare<unknown[], { total: number; unique_count: number }>(
          `SELECT COUNT(*) AS total, COUNT(DISTINCT ${assertColumn(spec.field)}) AS unique_count ` +
            `${source.from} WHERE ${source.where}${where.sql}`,
        )
        .get(...source.params, ...where.params);

      return row !== undefined && row.total >= spec.minRows && row.unique_count === 1 ? 1 : 0;
    }

    case "conditional": {
      const when = evaluateCriteria(spec.when, ctx);
      if (!compare(when, spec.op, spec.value)) {
        return spec.otherwise === undefined ? 0 : evaluateCriteria(spec.otherwise, ctx);
      }
      return evaluateCriteria(spec.then, ctx);
    }

    case "allOf": {
      for (const check of spec.checks) {
        if (!compare(evaluateCriteria(check.spec, ctx), check.op, check.value)) return 0;
      }
      return 1;
    }

    case "score": {
      let total = 0;
      for (const component of spec.components) {
        if (compare(evaluateCriteria(component.spec, ctx), component.op, component.value)) {
          total += component.points;
        }
      }
      return total;
    }
  }
}
