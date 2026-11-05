import type { AppDatabase } from "../db/client.ts";
import {
  addDays,
  addMonthsClamped,
  daysBetween,
  monthBounds,
  todayUtc,
} from "../shared/utils/date.ts";
import { AuthRepository } from "../modules/auth/auth.repository.ts";
import { AccountsRepository } from "../modules/accounts/accounts.repository.ts";
import { CategoriesRepository } from "../modules/categories/categories.repository.ts";
import { TransactionsRepository } from "../modules/transactions/transactions.repository.ts";
import { TransactionsService } from "../modules/transactions/transactions.service.ts";
import { BudgetsRepository } from "../modules/budgets/budgets.repository.ts";
import { BudgetsService } from "../modules/budgets/budgets.service.ts";
import { GoalsRepository } from "../modules/goals/goals.repository.ts";
import { GoalsService } from "../modules/goals/goals.service.ts";
import { HabitsRepository } from "../modules/habits/habits.repository.ts";
import { HabitsService } from "../modules/habits/habits.service.ts";
import { InvestmentsRepository } from "../modules/investments/investments.repository.ts";
import { InvestmentsService } from "../modules/investments/investments.service.ts";
import { RecurringRepository } from "../modules/recurring/recurring.repository.ts";
import { RecurringService } from "../modules/recurring/recurring.service.ts";
import type { OutboxEvent } from "../events/events.types.ts";
import { type CorrelationPattern, detectCorrelationPatterns } from "./ai.correlation.ts";

export interface AiContextRegistry {
  build(event: OutboxEvent): Record<string, unknown> | null;
}

export class AiContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiContextError";
  }
}

interface Dependencies {
  readonly db: AppDatabase;
  readonly auth: AuthRepository;
  readonly transactions: TransactionsService;
  readonly budgets: BudgetsService;
  readonly goals: GoalsService;
  readonly habits: HabitsService;
  readonly investments: InvestmentsService;
  readonly recurring: RecurringService;
}

/**
 * Cria os builders de contexto reaproveitando os services de domínio.
 *
 * As métricas continuam sendo calculadas por SQL nos repositórios — o LLM só
 * recebe o resultado pronto. Nenhum builder aceita `userId` do payload: sempre
 * usa o `userId` gravado no evento.
 */
export function createContextRegistry(db: AppDatabase): AiContextRegistry {
  const auth = new AuthRepository(db);
  const accounts = new AccountsRepository(db);
  const categories = new CategoriesRepository(db);
  const transactionRepository = new TransactionsRepository(db);
  const transactions = new TransactionsService({
    db,
    repository: transactionRepository,
    accounts,
    categories,
  });

  const dependencies: Dependencies = {
    db,
    auth,
    transactions,
    budgets: new BudgetsService({
      repository: new BudgetsRepository(db),
      categories,
      preferences: auth,
    }),
    goals: new GoalsService({
      db,
      repository: new GoalsRepository(db),
      accounts,
      preferences: auth,
    }),
    habits: new HabitsService({ db, repository: new HabitsRepository(db) }),
    investments: new InvestmentsService({
      db,
      repository: new InvestmentsRepository(db),
      accounts,
      preferences: auth,
    }),
    recurring: new RecurringService({
      db,
      repository: new RecurringRepository(db),
      transactions: transactionRepository,
      accounts,
      categories,
    }),
  };

  return {
    build(event) {
      if (event.type.startsWith("finance.")) return buildFinance(dependencies, event);
      if (event.type.startsWith("habit.")) return buildHabit(dependencies, event);
      if (event.type.startsWith("investment.")) return buildInvestment(dependencies, event);
      if (event.type.startsWith("security.")) return buildSecurity(dependencies, event);
      if (event.type.startsWith("recurring.")) return buildRecurring(dependencies, event);
      if (event.type.startsWith("correlation.")) return buildCorrelation(dependencies, event);
      return null;
    },
  };
}

function buildFinance(deps: Dependencies, event: OutboxEvent): Record<string, unknown> {
  const today = todayUtc();
  const currentMonth = monthBounds(today);

  const budgets = deps.budgets.status(event.userId, today).map((status) => ({
    id: status.budget.id,
    name: status.budget.name,
    categoryName: status.budget.categoryName,
    limitMinor: status.budget.limitMinor,
    spentMinor: status.spentMinor,
    remainingMinor: status.remainingMinor,
    percentage: status.percentUsed,
    status: status.level,
    period: status.period,
  }));

  const goals = deps.goals.list(event.userId).map((goal) => {
    const progress = deps.goals.progress(event.userId, goal.id);
    const daysRemaining = goal.targetDate === null
      ? null
      : Math.max(0, daysBetween(today, goal.targetDate));

    return {
      id: goal.id,
      name: goal.name,
      targetMinor: goal.targetAmountMinor,
      contributedMinor: progress.contributedMinor,
      remainingMinor: progress.remainingMinor,
      percentage: progress.progressPercent,
      status: goal.status,
      targetDate: goal.targetDate,
      daysRemaining,
      monthlyNeededMinor: daysRemaining !== null && daysRemaining > 0
        ? Math.round((progress.remainingMinor * 30) / daysRemaining)
        : null,
    };
  });

  const summary = deps.transactions.summary(event.userId, currentMonth);
  const incomeMinor = sumSummary(summary, "incomeMinor");
  const expenseMinor = sumSummary(summary, "expenseMinor");
  const netMinor = incomeMinor - expenseMinor;
  const daysInMonth = daysBetween(currentMonth.from, currentMonth.to) + 1;
  const daysLeftInMonth = Math.max(0, daysBetween(today, currentMonth.to));

  const spendingTrend = [2, 1, 0].map((offset) => {
    const bounds = monthBounds(addMonthsClamped(currentMonth.from, -offset));
    const monthSummary = deps.transactions.summary(event.userId, bounds);
    return {
      month: bounds.from.slice(0, 7),
      incomeMinor: sumSummary(monthSummary, "incomeMinor"),
      expenseMinor: sumSummary(monthSummary, "expenseMinor"),
    };
  });

  const topCategories = summary.currencies
    .flatMap((currency) => currency.byCategory)
    .filter((category) => category.type === "expense")
    .sort((a, b) => b.amountMinor - a.amountMinor)
    .slice(0, 5)
    .map((category) => ({
      name: category.categoryName ?? "Sem categoria",
      totalMinor: category.amountMinor,
    }));

  const recentTransactions = deps.transactions
    .list(event.userId, { limit: 5, offset: 0 })
    .items.map((transaction) => ({
      id: transaction.id,
      type: transaction.type,
      amountMinor: transaction.amountMinor,
      description: transaction.description,
      transactionDate: transaction.transactionDate,
      categoryId: transaction.categoryId,
    }));

  return {
    currentEvent: event.payload,
    budgets,
    goals,
    monthlySummary: {
      incomeMinor,
      expenseMinor,
      netMinor,
      savingsRate: incomeMinor > 0 ? Math.round((netMinor * 10_000) / incomeMinor) / 100 : null,
      daysLeftInMonth,
      daysInMonth,
    },
    spendingTrend,
    topCategories,
    anomaly: findSpendingAnomaly(deps, event.userId, currentMonth),
    recentTransactions,
  };
}

function buildHabit(deps: Dependencies, event: OutboxEvent): Record<string, unknown> {
  const today = todayUtc();
  const last30 = addDays(today, -29);
  const last7 = addDays(today, -6);
  const milestoneDays = new Set([7, 14, 21, 30, 60, 90]);

  const habits = deps.habits.list(event.userId).map((habit) => {
    const streak = deps.habits.streak(event.userId, habit.id, today);
    const calendar = deps.habits.calendar(
      event.userId,
      habit.id,
      { from: last30, to: today },
      today,
    );
    const completions30d = calendar.days.filter((day) => day.completed).length;
    const completions7d = calendar.days
      .filter((day) => day.date >= last7 && day.completed).length;

    return {
      id: habit.id,
      name: habit.name,
      habitType: habit.habitType,
      frequencyType: habit.frequencyType,
      dailyTarget: habit.dailyTarget,
      parentHabitId: habit.parentHabitId,
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
      lastCompletedDate: streak.lastCompletedDate,
      completedToday: streak.completedToday,
      scheduledToday: streak.scheduledToday,
      completions7d,
      completions30d,
      daysSinceLast: streak.lastCompletedDate === null
        ? 999
        : Math.max(0, daysBetween(streak.lastCompletedDate, today)),
    };
  });

  const milestones = habits
    .filter((habit) => milestoneDays.has(habit.currentStreak))
    .map((habit) => ({
      habitId: habit.id,
      name: habit.name,
      currentStreak: habit.currentStreak,
    }));

  return {
    currentEvent: event.payload,
    habits,
    recentLogs: deps.db
      .prepare<
        [string, string],
        {
          habit_id: string;
          habit_name: string;
          log_date: string;
          value: number;
          note: string | null;
        }
      >(
        `SELECT hl.habit_id, h.name AS habit_name, hl.log_date, hl.value, hl.note
         FROM habit_logs hl
         JOIN habits h ON h.id = hl.habit_id
         WHERE h.user_id = ? AND hl.deleted_at IS NULL AND hl.log_date >= ?
         ORDER BY hl.log_date DESC`,
      )
      .all(event.userId, last7),
    triggers: deps.habits.listTriggers(event.userId),
    consecutiveMisses: Math.max(
      0,
      ...habits.map((habit) => habit.daysSinceLast >= 2 ? habit.daysSinceLast : 0),
    ),
    streakMilestones: milestones.length > 0 ? milestones : null,
  };
}

function buildInvestment(deps: Dependencies, event: OutboxEvent): Record<string, unknown> {
  const portfolio = deps.investments.portfolio(event.userId);
  const totalsByCurrency = new Map(
    portfolio.totals.map((total) => [total.currencyCode, total.costBasisMinor]),
  );

  const positions = portfolio.positions.map((position) => {
    const currencyTotal = totalsByCurrency.get(position.currencyCode) ?? 0;
    return {
      investmentId: position.investmentId,
      ticker: position.ticker,
      name: position.name,
      assetClass: position.assetClass,
      currencyCode: position.currencyCode,
      quantity: position.quantity,
      costBasisMinor: position.costBasisMinor,
      averageCostMinor: position.averageCostMinor,
      currentPriceMinor: position.currentPriceMinor,
      marketValueMinor: position.marketValueMinor,
      unrealizedPnlMinor: position.unrealizedPnlMinor,
      totalPnlMinor: position.totalPnlMinor,
      returnPercent: position.returnPercent,
      percentageOfPortfolio: currencyTotal > 0
        ? Math.round((position.costBasisMinor * 10_000) / currencyTotal) / 100
        : 0,
    };
  });

  return {
    currentEvent: event.payload,
    positions,
    portfolio: {
      totals: portfolio.totals,
      diversificationScore: diversificationScore(positions),
    },
    overtrading: deps.db
      .prepare<[string, string], { ticker: string; trades: number }>(
        `SELECT i.ticker, COUNT(*) AS trades
         FROM investment_transactions it
         JOIN investments i ON i.id = it.investment_id
         WHERE i.user_id = ? AND i.deleted_at IS NULL AND it.operation_date >= ?
         GROUP BY i.ticker
         HAVING COUNT(*) >= 3
         ORDER BY trades DESC`,
      )
      .all(event.userId, addDays(todayUtc(), -30)),
    recentTransactions: deps.db
      .prepare<
        [string],
        {
          ticker: string;
          operation_type: string;
          quantity: number;
          unit_price_minor: number;
          fees_minor: number;
          operation_date: string;
        }
      >(
        `SELECT i.ticker, it.operation_type, it.quantity, it.unit_price_minor,
                it.fees_minor, it.operation_date
         FROM investment_transactions it
         JOIN investments i ON i.id = it.investment_id
         WHERE i.user_id = ? AND i.deleted_at IS NULL
         ORDER BY it.operation_date DESC, it.created_at DESC, it.rowid DESC
         LIMIT 5`,
      )
      .all(event.userId),
  };
}

function buildSecurity(deps: Dependencies, event: OutboxEvent): Record<string, unknown> {
  const now = new Date().toISOString();
  const today = todayUtc();
  const last7 = `${addDays(today, -6)}T00:00:00.000Z`;
  const sessions = deps.auth.listSessions(event.userId);
  const activeSessions = sessions.filter((session) =>
    session.revokedAt === null && session.expiresAt > now
  );
  const recentSessions = activeSessions.slice(0, 3);
  const uniqueIps = new Set(
    activeSessions
      .filter((session) => session.createdAt >= last7)
      .map((session) => session.ipAddress)
      .filter((ip): ip is string => ip !== null),
  );

  const suspiciousIps = deps.db
    .prepare<[string, string], { ip: string | null; failures: number }>(
      `SELECT ip_address AS ip, COUNT(*) AS failures
       FROM auth_events
       WHERE user_id = ? AND type = 'login_failed' AND created_at >= ?
       GROUP BY ip_address
       HAVING COUNT(*) >= 3
       ORDER BY failures DESC`,
    )
    .all(event.userId, `${today}T00:00:00.000Z`);

  const currentIp = typeof event.payload.ipAddress === "string" ? event.payload.ipAddress : null;
  const recentIpSet = new Set(recentSessions.map((session) => session.ipAddress));

  return {
    currentEvent: event.payload,
    activeSessionCount: deps.auth.countActiveSessions(event.userId, now),
    uniqueIps7d: uniqueIps.size,
    recentSessions: recentSessions.map((session) => ({
      id: session.id,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
    })),
    suspiciousIps: suspiciousIps.length > 0 ? suspiciousIps : null,
    bruteForceDetected: suspiciousIps.some((row) => row.failures >= 5),
    newIpDetected: currentIp !== null && !recentIpSet.has(currentIp),
  };
}

function buildRecurring(deps: Dependencies, event: OutboxEvent): Record<string, unknown> {
  const today = todayUtc();
  const recurring = deps.recurring.list(event.userId).map((item) => ({
    id: item.id,
    description: item.description,
    type: item.type,
    amountMinor: item.amountMinor,
    currencyCode: item.currencyCode,
    frequency: item.frequency,
    interval: item.interval,
    nextOccurrence: item.nextOccurrence,
    categoryName: item.categoryName,
    accountName: item.accountName,
  }));

  const monthlyCommitmentMinor = recurring.reduce(
    (total, item) => total + monthlyAmount(item.amountMinor, item.frequency, item.interval),
    0,
  );

  const upcoming = recurring.filter((item) =>
    item.nextOccurrence >= today && item.nextOccurrence <= addDays(today, 7)
  );

  const last3 = monthBounds(addMonthsClamped(today, -2));
  const history = deps.transactions.summary(event.userId, {
    from: last3.from,
    to: monthBounds(today).to,
  });
  const averageMonthlyIncomeMinor = Math.round(sumSummary(history, "incomeMinor") / 3);

  return {
    currentEvent: event.payload,
    recurringTransactions: recurring,
    upcomingIn7Days: {
      count: upcoming.length,
      totalMinor: upcoming.reduce((total, item) => total + item.amountMinor, 0),
    },
    totalMonthlyCommitmentMinor: monthlyCommitmentMinor,
    averageMonthlyIncomeMinor,
    overdueCount: recurring.filter((item) => item.nextOccurrence < today).length,
  };
}

function buildCorrelation(deps: Dependencies, event: OutboxEvent): Record<string, unknown> {
  const patternType = typeof event.payload.patternType === "string"
    ? event.payload.patternType
    : null;
  if (patternType === null) {
    throw new AiContextError("Evento de correlação sem patternType");
  }

  const patterns = detectCorrelationPatterns(deps.db, event.userId, todayUtc());
  const pattern = patterns.find((candidate) => candidate.type === patternType);
  if (!pattern) {
    throw new AiContextError(`Padrão de correlação não encontrado: ${patternType}`);
  }

  return {
    currentEvent: event.payload,
    patternType: pattern.type,
    patternLabel: pattern.label,
    period: pattern.period,
    confidence: pattern.confidence,
    data: pattern.data,
  };
}

function sumSummary(
  summary: { currencies: Array<{ incomeMinor: number; expenseMinor: number }> },
  field: "incomeMinor" | "expenseMinor",
): number {
  return summary.currencies.reduce((total, currency) => total + currency[field], 0);
}

function findSpendingAnomaly(
  deps: Dependencies,
  userId: string,
  currentMonth: { from: string; to: string },
): Record<string, unknown> | null {
  const current = categoryExpenses(deps, userId, currentMonth);
  const previous = [1, 2, 3].map((offset) =>
    categoryExpenses(deps, userId, monthBounds(addMonthsClamped(currentMonth.from, -offset)))
  );

  let best: Record<string, unknown> | null = null;
  let bestSpike = 30;

  for (const [name, total] of current) {
    const history = previous
      .map((month) => month.get(name))
      .filter((value): value is number => value !== undefined);
    if (history.length < 2) continue;

    const average = history.reduce((sum, value) => sum + value, 0) / history.length;
    if (average <= 0) continue;

    const spike = Math.round(((total - average) / average) * 100);
    if (spike > bestSpike) {
      bestSpike = spike;
      best = {
        categoryName: name,
        currentMinor: total,
        averageMinor: Math.round(average),
        spikePercentage: spike,
      };
    }
  }

  return best;
}

function categoryExpenses(
  deps: Dependencies,
  userId: string,
  bounds: { from: string; to: string },
): Map<string, number> {
  const summary = deps.transactions.summary(userId, bounds);
  const result = new Map<string, number>();

  for (const currency of summary.currencies) {
    for (const category of currency.byCategory) {
      if (category.type !== "expense") continue;
      const name = category.categoryName ?? "Sem categoria";
      result.set(name, (result.get(name) ?? 0) + category.amountMinor);
    }
  }

  return result;
}

function diversificationScore(
  positions: Array<{ percentageOfPortfolio: number }>,
): "low" | "medium" | "high" {
  const top = positions.reduce(
    (maximum, position) => Math.max(maximum, position.percentageOfPortfolio),
    0,
  );
  return top > 50 ? "low" : top > 30 ? "medium" : "high";
}

function monthlyAmount(
  amountMinor: number,
  frequency: "daily" | "weekly" | "monthly" | "yearly",
  interval: number,
): number {
  const multiplier = frequency === "daily"
    ? 30
    : frequency === "weekly"
    ? 4.33
    : frequency === "yearly"
    ? 1 / 12
    : 1;

  return Math.round((amountMinor * multiplier) / Math.max(1, interval));
}

export type { CorrelationPattern };
