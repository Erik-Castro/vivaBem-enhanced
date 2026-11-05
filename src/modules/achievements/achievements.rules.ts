import type {
  CompareOp,
  Condition,
  CriteriaSpec,
  DatasetName,
  FnName,
  Operand,
  StreakUnit,
} from "./achievements.criteria.ts";

/**
 * Catálogo declarativo de regras de conquista.
 *
 * Cada entrada mapeia o nome legado (`TOTAL_TRANSACTIONS_COUNT`, ...) para uma
 * especificação da DSL. Regras que variam por conquista recebem parâmetros
 * (hoje apenas o dia da semana) e devolvem a especificação concreta.
 */

export interface CriteriaParams {
  /** 0 = domingo … 6 = sábado (mesmo formato de `strftime('%w')`). */
  readonly weekday?: number;
}

type CriteriaDefinition = CriteriaSpec | ((params: CriteriaParams) => CriteriaSpec);

const column = (name: string): Operand => ({ column: name });
const literal = (value: string | number | null): Operand => ({ value });
const current = (name: FnName): Operand => ({ fn: name });

const compare = (left: Operand, op: CompareOp, right?: Operand): Condition => ({
  left,
  op,
  right,
});

const eq = (name: string, value: string | number | null): Condition =>
  compare(column(name), "eq", literal(value));
const ne = (name: string, value: string | number | null): Condition =>
  compare(column(name), "ne", literal(value));
const gt = (name: string, value: string | number): Condition =>
  compare(column(name), "gt", literal(value));
const gte = (name: string, value: string | number): Condition =>
  compare(column(name), "gte", literal(value));
const lt = (name: string, value: string | number): Condition =>
  compare(column(name), "lt", literal(value));
const lte = (name: string, value: string | number): Condition =>
  compare(column(name), "lte", literal(value));
const notNull = (name: string): Condition => compare(column(name), "notNull");
const notEmpty = (name: string): Condition => compare(column(name), "notEmpty");
const equalsColumn = (left: string, right: string): Condition =>
  compare(column(left), "eq", column(right));
const greaterThanColumn = (left: string, right: string): Condition =>
  compare(column(left), "gt", column(right));
const between = (name: string, low: string | number, high: string | number): Condition => ({
  all: [gte(name, low), lte(name, high)],
});

const count = (
  dataset: DatasetName,
  where?: readonly Condition[],
  distinctField?: string,
): CriteriaSpec => ({ kind: "count", dataset, where, distinctField });
const exists = (dataset: DatasetName, where?: readonly Condition[]): CriteriaSpec => ({
  kind: "exists",
  dataset,
  where,
});
const sum = (
  dataset: DatasetName,
  field: string,
  where?: readonly Condition[],
): CriteriaSpec => ({ kind: "sum", dataset, field, where });
const max = (
  dataset: DatasetName,
  field: string,
  where?: readonly Condition[],
): CriteriaSpec => ({ kind: "max", dataset, field, where });
const maxGroup = (
  dataset: DatasetName,
  field: string,
  where?: readonly Condition[],
): CriteriaSpec => ({ kind: "maxGroup", dataset, field, where });
const maxGroupDays = (
  dataset: DatasetName,
  groupBy: string,
  dateField: string,
  where?: readonly Condition[],
): CriteriaSpec => ({ kind: "maxGroupDays", dataset, groupBy, dateField, where });
const streak = (
  dataset: DatasetName,
  dateField: string,
  unit: StreakUnit,
  where?: readonly Condition[],
): CriteriaSpec => ({ kind: "streak", dataset, dateField, unit, where });
const maxGroupStreak = (
  dataset: DatasetName,
  groupBy: string,
  dateField: string,
  unit: StreakUnit,
  where?: readonly Condition[],
): CriteriaSpec => ({ kind: "maxGroupStreak", dataset, groupBy, dateField, unit, where });
const rowStreak = (
  dataset: DatasetName,
  orderBy: readonly string[],
  where?: readonly Condition[],
): CriteriaSpec => ({ kind: "rowStreak", dataset, orderBy, where });
const sameValueStreak = (
  dataset: DatasetName,
  field: string,
  orderBy: readonly string[],
  where?: readonly Condition[],
): CriteriaSpec => ({ kind: "sameValueStreak", dataset, field, orderBy, where });
const daysSince = (
  dataset: DatasetName,
  dateField: string,
  aggregate: "min" | "max",
  where?: readonly Condition[],
  emptyValue?: number,
  offset?: number,
): CriteriaSpec => ({
  kind: "daysSince",
  dataset,
  dateField,
  aggregate,
  where,
  emptyValue,
  offset,
});
const ratioPredicate = (
  numerator: CriteriaSpec,
  denominator: CriteriaSpec,
  op: CompareOp,
  value: number,
  emptyValue?: number,
): CriteriaSpec => ({ kind: "ratioPredicate", numerator, denominator, op, value, emptyValue });
const maxRatioPredicate = (
  dataset: DatasetName,
  leftField: string,
  rightField: string,
  where: readonly Condition[] | undefined,
  op: CompareOp,
  value: number,
): CriteriaSpec => ({
  kind: "maxRatioPredicate",
  dataset,
  leftField,
  rightField,
  where,
  op,
  value,
});
const uniform = (
  dataset: DatasetName,
  field: string,
  minRows: number,
  where?: readonly Condition[],
): CriteriaSpec => ({ kind: "uniform", dataset, field, minRows, where });
const conditional = (
  when: CriteriaSpec,
  op: CompareOp,
  value: number,
  then: CriteriaSpec,
  otherwise?: CriteriaSpec,
): CriteriaSpec => ({ kind: "conditional", when, op, value, then, otherwise });
const allOf = (
  checks: readonly {
    readonly spec: CriteriaSpec;
    readonly op: CompareOp;
    readonly value: number;
  }[],
): CriteriaSpec => ({ kind: "allOf", checks });
const score = (
  components: readonly {
    readonly spec: CriteriaSpec;
    readonly op: CompareOp;
    readonly value: number;
    readonly points: number;
  }[],
): CriteriaSpec => ({ kind: "score", components });
const constant = (value: number): CriteriaSpec => ({ kind: "constant", value });

const TODAY = compare(column("t.transaction_date"), "eq", current("today"));
const LOG_TODAY = compare(column("hl.log_date"), "eq", current("today"));
const THIS_MONTH = compare(column("t.month"), "eq", current("thisMonth"));
const WEEKDAY_ONLY = between("hl.weekday", 1, 5);
const WEEKEND_ONLY: Condition = {
  any: [eq("hl.weekday", 0), eq("hl.weekday", 6)],
};

const UNASSIGNED_CATEGORY: Condition = {
  any: [
    compare(column("t.category_id"), "isNull"),
    eq("t.category_id", ""),
  ],
};

/**
 * Progresso das conquistas de categorização: a razão de transações sem
 * categoria precisa ficar abaixo de 5%; a partir daí o progresso vira tempo
 * (dias desde a primeira transação + 1) para atender às metas de 1/120/365 dias.
 */
const LOW_UNASSIGNED_RATIO = ratioPredicate(
  count("transactions", [UNASSIGNED_CATEGORY]),
  count("transactions"),
  "lt",
  0.05,
  1,
);

function consecutiveDayOfWeek(params: CriteriaParams): CriteriaSpec {
  const weekday = params.weekday;
  if (typeof weekday === "number" && Number.isInteger(weekday) && weekday >= 0 && weekday <= 6) {
    return streak("habitLogsWeekday", "hl.log_date", "week", [eq("hl.weekday", weekday)]);
  }
  return maxGroupStreak("habitLogsWeekday", "hl.weekday", "hl.log_date", "week");
}

export const CRITERIA_RULES: Record<string, CriteriaDefinition> = {
  ACCOUNT_CREATED: count("accounts"),
  ACCOUNT_LONGEVITY_DAYS: daysSince("accounts", "a.created_at", "min"),
  ACHIEVEMENTS_UNLOCKED_COUNT: count("userAchievements"),
  ACTIVE_ACCOUNTS_COUNT: count("accounts", [eq("a.is_active", 1)]),
  ACTIVE_WEEKLY_HABITS: count("habits", [
    eq("h.frequency_type", "weekly"),
    eq("h.is_active", 1),
  ]),
  ALL_DAYS_HABIT_LOGGED: count(
    "habitLogs",
    [compare(column("hl.log_date"), "gte", current("sevenDaysAgo"))],
    "hl.log_date",
  ),
  ASSET_CLASS_COUNT: count("investments", undefined, "i.asset_class"),
  ASSET_HOLDING_DAYS: maxGroupDays(
    "investmentTransactions",
    "i.ticker",
    "it.operation_date",
    [eq("it.operation_type", "buy")],
  ),
  AVATAR_CHANGE_COUNT: count("profiles", [notEmpty("p.avatar_url")]),
  CATEGORY_COLOR_UPDATE: exists("categories", [notEmpty("c.color")]),
  CATEGORY_CREATED: count("categories"),
  CLEAN_CREDIT_TRANSACTION: exists("transactionsCard"),
  CLEARED_CREDIT_TX: count("transactionsCard", [eq("t.is_cleared", 1)]),
  CLOSING_MINUTE_TX: exists("transactionsCardDetails", [
    TODAY,
    compare(column("ccd.closing_day"), "eq", current("nowDay")),
    compare(current("nowMinute"), "eq", literal(0)),
  ]),
  CONSECUTIVE_DAY_OF_WEEK: consecutiveDayOfWeek,
  CONSECUTIVE_MONTHS_INVESTING: streak("investmentTransactions", "it.operation_date", "month", [
    eq("it.operation_type", "buy"),
  ]),
  CONSECUTIVE_MONTHS_LOGIN: streak("sessions", "s.created_at", "month"),
  CONSECUTIVE_RECURRING_MONTHS: streak("recurringOccurrences", "ro.occurrence_date", "month"),
  CONSECUTIVE_TX_WITH_DESC: rowStreak(
    "transactions",
    ["t.transaction_date DESC", "t.created_at DESC", "t.rowid DESC"],
    [notEmpty("t.description")],
  ),
  CONSECUTIVE_WEEKLY_SUCCESS: streak("habitLogs", "hl.log_date", "week", [
    eq("h.frequency_type", "weekly"),
  ]),
  CREDIT_CARD_ADDED: exists("accounts", [eq("a.type", "credit_card")]),
  CREDIT_STREAK_ONE_DAY: count("transactionsCard", [TODAY]),
  DAILY_ASSET_CLASSES_BOUGHT: count(
    "investmentTransactions",
    [eq("it.operation_type", "buy"), compare(column("it.operation_date"), "eq", current("today"))],
    "i.asset_class",
  ),
  DAILY_LOG_COUNT: count("habitLogs", [LOG_TODAY]),
  DAILY_TX_COUNT: count("transactions", [TODAY]),
  DAYS_SINCE_SIGNUP: daysSince("profiles", "p.created_at", "min"),
  DELAYED_CLEARING: daysSince("transactions", "t.transaction_date", "max", [
    eq("t.is_cleared", 1),
  ]),
  DISTINCT_ACCOUNT_TYPES: count("accounts", undefined, "a.type"),
  DISTINCT_CURRENCIES_COUNT: count("accounts", undefined, "a.currency_code"),
  DISTINCT_INVEST_DAYS: count("investmentTransactions", undefined, "it.operation_date"),
  DISTINCT_IPS_COUNT: count("sessions", [notNull("s.ip_address")], "s.ip_address"),
  DISTINCT_SESSIONS_DAYS: count("sessionDays", undefined, "s.session_date"),
  DISTINCT_TICKERS_COUNT: count("investments", undefined, "i.ticker"),
  DISTINCT_TRANSACTION_DAYS: count("transactions", undefined, "t.transaction_date"),
  EARLY_LOG: exists("habitLogsHourly", [lt("hl.log_hour", "07")]),
  EMAIL_VERIFIED_TRUE: exists("credentials", [eq("uc.email_verified", 1)]),
  EXTREME_INSTALLMENTS: exists("transactionsCard", [gte("cct.total_installments", 48)]),
  FOREIGN_ACCOUNT_CREATED: exists("accounts", [ne("a.currency_code", "USD")]),
  FOREIGN_INVESTMENT: exists("investments", [
    compare(column("i.ticker"), "notLike", literal("%.SA")),
    compare(column("i.ticker"), "notLike", literal("%.B3")),
  ]),
  HABIT_COLOR_UPDATE: exists("habits", [notEmpty("h.color")]),
  HABIT_CREATED: count("habits"),
  HABIT_LOG_CREATED: exists("habitLogs"),
  HABIT_PURGE: count("habitsLength", [
    eq("h.is_active", 0),
    compare(column("h.updated_day"), "eq", current("today")),
  ]),
  HABIT_REORDERED: exists("habits", [ne("h.order_index", 0)]),
  HABIT_STREAK_DAYS: maxGroupStreak("habitLogs", "hl.habit_id", "hl.log_date", "day"),
  HABIT_WITH_DESC: exists("habits", [notEmpty("h.description")]),
  HABIT_WITH_TARGET: exists("habits", [gt("h.daily_target", 1)]),
  HIGH_FEES_WARNING: exists("investmentTransactions", [
    greaterThanColumn("it.fees_minor", "it.unit_price_minor"),
  ]),
  INSOMNIA_LOGS: count("habitLogsHourly", [between("hl.log_hour", "01", "03")]),
  INSTALLMENT_TX_CREATED: exists("transactionsCard", [gt("cct.total_installments", 2)]),
  INVESTMENT_BUY: exists("investmentTransactions", [eq("it.operation_type", "buy")]),
  INVESTMENT_CREATED: count("investments"),
  INVESTMENT_WITH_FEES: count("investmentTransactions", [gt("it.fees_minor", 0)]),
  INVESTMENT_ZERO_FEES: exists("investmentTransactions", [
    eq("it.operation_type", "buy"),
    eq("it.fees_minor", 0),
  ]),
  LIMIT_MAXED_OUT: ratioPredicate(
    sum("transactionsCardMonthly", "t.amount_minor", [THIS_MONTH]),
    max("creditCardDetails", "ccd.limit_minor"),
    "gte",
    0.95,
  ),
  LOCALE_UPDATE: exists("preferences", [ne("pref.locale", "en")]),
  LOGIN_STREAK: streak("sessions", "s.created_at", "day"),
  LOG_WITH_NOTE: exists("habitLogs", [notEmpty("hl.note")]),
  LONG_HABIT_DESC: exists("habitsLength", [gt("h.description_length", 1000)]),
  LOW_FEES_RATIO: ratioPredicate(
    sum("investmentTransactionValues", "it.fees_minor"),
    sum("investmentTransactionValues", "it.gross_minor"),
    "lt",
    0.01,
    1,
  ),
  LOW_UNASSIGNED_CATEGORY: conditional(
    LOW_UNASSIGNED_RATIO,
    "gte",
    1,
    daysSince("transactions", "t.created_at", "min", undefined, 0, 1),
    constant(0),
  ),
  MASSIVE_LOG_VALUE: maxRatioPredicate(
    "habitLogs",
    "hl.value",
    "h.daily_target",
    [gt("h.daily_target", 0)],
    "gte",
    10,
  ),
  MASTER_USER_METRIC: allOf([
    { spec: daysSince("profiles", "p.created_at", "min"), op: "gte", value: 300 },
    { spec: exists("profiles", [notEmpty("p.avatar_url")]), op: "gte", value: 1 },
  ]),
  MAX_CREDIT_TX_MONTHLY: count("transactionsCardMonthly", [THIS_MONTH]),
  MINIMAL_LOG_STREAK: rowStreak("habitLogs", ["hl.created_at DESC", "hl.id DESC"], [
    eq("hl.value", 1),
  ]),
  MONOCHROME_CATEGORIES: uniform("categories", "c.color", 5, [notEmpty("c.color")]),
  MONO_TICKER_STREAK: sameValueStreak(
    "investmentTransactions",
    "i.ticker",
    ["it.operation_date DESC", "it.created_at DESC", "it.rowid DESC"],
    [eq("it.operation_type", "buy")],
  ),
  NESTED_CATEGORY_CREATED: count("categories", [notNull("c.parent_id")]),
  NESTED_HABIT_CREATED: count("habits", [notNull("h.parent_habit_id")]),
  NIGHT_TRANSACTION: exists("transactions", [{
    any: [
      compare(current("nowHour"), "gte", literal(23)),
      compare(current("nowHour"), "lt", literal(4)),
    ],
  }]),
  NO_SELL_STREAK: daysSince("investmentTransactions", "it.operation_date", "max", [
    eq("it.operation_type", "sell"),
  ], 300),
  PREFERENCE_RESET_COUNT: count("preferences", [notNull("pref.updated_at")]),
  PREFERENCES_UPDATE: exists("preferences", [ne("pref.timezone", "UTC")]),
  PROFILE_AVATAR_UPDATE: exists("profiles", [notEmpty("p.avatar_url")]),
  PROFILE_COMPLETENESS: score([
    { spec: exists("profiles", [notEmpty("p.name")]), op: "gte", value: 1, points: 25 },
    { spec: exists("profiles", [notEmpty("p.avatar_url")]), op: "gte", value: 1, points: 10 },
    { spec: exists("preferences", [ne("pref.timezone", "UTC")]), op: "gte", value: 1, points: 15 },
    {
      spec: exists("preferences", [ne("pref.base_currency", "USD")]),
      op: "gte",
      value: 1,
      points: 15,
    },
    { spec: exists("preferences", [ne("pref.locale", "en")]), op: "gte", value: 1, points: 10 },
    { spec: exists("credentials", [eq("uc.email_verified", 1)]), op: "gte", value: 1, points: 25 },
  ]),
  RECURRING_TX_CREATED: exists("recurringOccurrences"),
  SHORT_HABIT_NAME: exists("habitsLength", [lte("h.name_length", 3)]),
  SHORT_TERM_SELL: exists("investmentSells", [notNull("it.days_held"), lt("it.days_held", 15)]),
  SUM_LOG_VALUES: sum("habitLogs", "hl.value"),
  TARGET_EXACT_MATCHES: count("habitLogs", [equalsColumn("hl.value", "h.daily_target")]),
  TARGET_EXCEEDED_COUNT: count("habitLogs", [greaterThanColumn("hl.value", "h.daily_target")]),
  TOTAL_CATEGORIES_COUNT: count("categories"),
  TOTAL_CLEARED_TX_COUNT: count("transactions", [eq("t.is_cleared", 1)]),
  TOTAL_CREDIT_TRANSACTIONS: count("transactionsCard"),
  TOTAL_INVESTMENT_BUYS: count("investmentTransactions", [eq("it.operation_type", "buy")]),
  TOTAL_LOGINS: count("sessions"),
  TOTAL_LOGS_COUNT: count("habitLogs"),
  TOTAL_LOGS_WITH_NOTES: count("habitLogs", [notEmpty("hl.note")]),
  TOTAL_NESTED_HABITS: count("habits", [notNull("h.parent_habit_id")]),
  TOTAL_TRANSACTIONS_COUNT: count("transactions"),
  TOTAL_TRANSFERS_COUNT: count(
    "transactions",
    [notNull("t.transfer_group_id")],
    "t.transfer_group_id",
  ),
  TRANSACTION_CLEARED: exists("transactions", [eq("t.is_cleared", 1)]),
  TRANSACTION_EXPENSE: exists("transactions", [eq("t.type", "expense")]),
  TRANSACTION_INCOME: exists("transactions", [eq("t.type", "income")]),
  TRANSFER_TRANSACTION: exists("transactions", [notNull("t.transfer_group_id")]),
  TRIGGER_CREATED: count("triggers"),
  TRIGGER_REPLACEMENT: exists("triggers", [notNull("ht.replacement_habit_id")]),
  TRIGGER_REPLACEMENT_USED: count("habitLogs", [
    notNull("hl.trigger_id"),
    eq("hl.replacement_used", 1),
  ]),
  TX_ON_CLOSING_DAY: exists("transactionsCardDetails", [
    TODAY,
    compare(column("ccd.closing_day"), "eq", current("nowDay")),
  ]),
  TX_ON_DUE_DAY: exists("transactionsCardDetails", [
    TODAY,
    compare(column("ccd.due_day"), "eq", current("nowDay")),
  ]),
  TX_PER_TICKER_COUNT: maxGroup("investmentTransactions", "i.ticker"),
  WEEKDAY_STREAK: streak("habitLogsWeekday", "hl.log_date", "businessDay", [WEEKDAY_ONLY]),
  WEEKEND_LOG: exists("habitLogsWeekday", [WEEKEND_ONLY]),
  WEEKLY_HABIT_CREATED: exists("habits", [eq("h.frequency_type", "weekly")]),
  ZERO_EXPENSE_STREAK: daysSince("transactions", "t.transaction_date", "max", [
    eq("t.type", "expense"),
  ], 0),
  ZERO_INSTALLMENT_MONTHS: count("transactionsCardMonthly", [
    eq("cct.total_installments", 1),
  ], "t.month"),
};

export function resolveCriteria(rule: string, params: CriteriaParams): CriteriaSpec | null {
  const definition = CRITERIA_RULES[rule];
  if (definition === undefined) return null;
  return typeof definition === "function" ? definition(params) : definition;
}
