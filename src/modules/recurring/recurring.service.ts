import type { AppDatabase } from "../../db/client.ts";
import { AppError } from "../../http/errors.ts";
import {
  addDays,
  addMonthsWithDay,
  dayOfMonth as dayOfMonthOf,
  todayUtc,
} from "../../shared/utils/date.ts";
import { uuidv7 } from "../../shared/utils/uuid.ts";
import type { Account, AccountsRepository } from "../accounts/accounts.repository.ts";
import type { CategoriesRepository, Category } from "../categories/categories.repository.ts";
import type {
  Transaction,
  TransactionsRepository,
} from "../transactions/transactions.repository.ts";
import type {
  RecurringFrequency,
  RecurringRepository,
  RecurringTransaction,
  RecurringType,
} from "./recurring.repository.ts";

/** Limite de ocorrências materializadas por recorrência em uma execução. */
const MAX_CATCH_UP_PER_RUN = 500;

export interface RecurringSchedule {
  readonly frequency: RecurringFrequency;
  readonly interval: number;
  readonly dayOfMonth: number | null;
  readonly startDate: string;
  readonly endDate: string | null;
}

export interface CreateRecurringInput {
  readonly accountId: string;
  readonly categoryId?: string | null;
  readonly type: RecurringType;
  readonly amountMinor: number;
  readonly currencyCode?: string;
  readonly description?: string | null;
  readonly frequency: RecurringFrequency;
  readonly interval: number;
  readonly dayOfMonth?: number | null;
  readonly startDate: string;
  readonly endDate?: string | null;
  readonly isActive?: boolean;
}

export interface UpdateRecurringInput {
  readonly accountId?: string;
  readonly categoryId?: string | null;
  readonly type?: RecurringType;
  readonly amountMinor?: number;
  readonly currencyCode?: string;
  readonly description?: string | null;
  readonly frequency?: RecurringFrequency;
  readonly interval?: number;
  readonly dayOfMonth?: number | null;
  readonly startDate?: string;
  readonly endDate?: string | null;
  readonly isActive?: boolean;
}

export interface UpcomingOccurrence {
  readonly recurringId: string;
  readonly accountId: string;
  readonly categoryId: string | null;
  readonly type: RecurringType;
  readonly amountMinor: number;
  readonly currencyCode: string;
  readonly description: string | null;
  readonly occurrenceDate: string;
}

export interface RunNowResult {
  readonly recurring: RecurringTransaction;
  readonly transaction: Transaction;
}

export interface ProcessDueResult {
  readonly processed: number;
  readonly recurrings: number;
}

export interface RecurringServiceDependencies {
  readonly db: AppDatabase;
  readonly repository: RecurringRepository;
  readonly transactions: TransactionsRepository;
  readonly accounts: AccountsRepository;
  readonly categories: CategoriesRepository;
}

export class RecurringService {
  readonly #db: AppDatabase;
  readonly #repository: RecurringRepository;
  readonly #transactions: TransactionsRepository;
  readonly #accounts: AccountsRepository;
  readonly #categories: CategoriesRepository;

  constructor(dependencies: RecurringServiceDependencies) {
    this.#db = dependencies.db;
    this.#repository = dependencies.repository;
    this.#transactions = dependencies.transactions;
    this.#accounts = dependencies.accounts;
    this.#categories = dependencies.categories;
  }

  list(userId: string, includeInactive = false): RecurringTransaction[] {
    return this.#repository.list(userId, includeInactive);
  }

  get(userId: string, recurringId: string): RecurringTransaction {
    const recurring = this.#repository.findById(userId, recurringId);
    if (!recurring) {
      throw new AppError("NOT_FOUND", "Recorrência não encontrada");
    }
    return recurring;
  }

  create(userId: string, input: CreateRecurringInput): RecurringTransaction {
    const account = this.#requireActiveAccount(userId, input.accountId);
    const currencyCode = this.#requireAccountCurrency(account, input.currencyCode);
    const categoryId = input.categoryId ?? null;
    if (categoryId !== null) {
      this.#requireCategory(userId, categoryId, input.type);
    }

    const schedule = normalizeSchedule(input, input.startDate);
    this.#assertDateRange(schedule.startDate, schedule.endDate);

    const recurringId = uuidv7();
    const now = new Date().toISOString();

    this.#repository.create({
      id: recurringId,
      userId,
      accountId: account.id,
      categoryId,
      type: input.type,
      amountMinor: input.amountMinor,
      currencyCode,
      description: normalizeDescription(input.description),
      frequency: schedule.frequency,
      interval: schedule.interval,
      dayOfMonth: schedule.dayOfMonth,
      startDate: schedule.startDate,
      endDate: schedule.endDate,
      nextOccurrence: schedule.startDate,
      isActive: input.isActive ?? true,
      now,
    });

    return this.get(userId, recurringId);
  }

  update(userId: string, recurringId: string, input: UpdateRecurringInput): RecurringTransaction {
    const current = this.get(userId, recurringId);
    const account = this.#requireActiveAccount(userId, input.accountId ?? current.accountId);
    const type = input.type ?? current.type;
    const categoryId = input.categoryId === undefined ? current.categoryId : input.categoryId;

    if (categoryId !== null) {
      this.#requireCategory(userId, categoryId, type);
    }

    const currencyCode = input.currencyCode ??
      (input.accountId !== undefined ? account.currencyCode : current.currencyCode);
    if (currencyCode !== account.currencyCode) {
      throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
        details: [{
          path: "currencyCode",
          message: "A moeda da recorrência precisa ser a mesma da conta",
        }],
      });
    }

    const startDate = input.startDate ?? current.startDate;
    const frequency = input.frequency ?? current.frequency;
    const dayOfMonth = resolveDayOfMonth(
      frequency,
      input.dayOfMonth === undefined ? current.dayOfMonth : input.dayOfMonth,
      startDate,
    );
    const schedule: RecurringSchedule = {
      frequency,
      interval: input.interval ?? current.interval,
      dayOfMonth,
      startDate,
      endDate: input.endDate === undefined ? current.endDate : input.endDate,
    };
    this.#assertDateRange(schedule.startDate, schedule.endDate);

    const scheduleChanged = frequency !== current.frequency ||
      schedule.interval !== current.interval ||
      startDate !== current.startDate ||
      dayOfMonth !== current.dayOfMonth;

    let nextOccurrence = scheduleChanged
      ? firstOccurrenceOnOrAfter(schedule, todayUtc())
      : current.nextOccurrence;
    let isActive = input.isActive ?? current.isActive;

    if (schedule.endDate !== null && nextOccurrence > schedule.endDate) {
      isActive = false;
    }
    if (nextOccurrence < schedule.startDate) {
      nextOccurrence = schedule.startDate;
    }

    this.#repository.update({
      id: recurringId,
      accountId: account.id,
      categoryId,
      type,
      amountMinor: input.amountMinor ?? current.amountMinor,
      currencyCode,
      description: input.description === undefined
        ? current.description
        : normalizeDescription(input.description),
      frequency: schedule.frequency,
      interval: schedule.interval,
      dayOfMonth: schedule.dayOfMonth,
      startDate: schedule.startDate,
      endDate: schedule.endDate,
      nextOccurrence,
      isActive,
      now: new Date().toISOString(),
    });

    return this.get(userId, recurringId);
  }

  delete(userId: string, recurringId: string): void {
    this.get(userId, recurringId);
    this.#repository.deactivate(userId, recurringId, new Date().toISOString());
  }

  /** Materializa a próxima ocorrência pendente, mesmo que a data seja futura. */
  runNow(userId: string, recurringId: string): RunNowResult {
    const recurring = this.get(userId, recurringId);

    if (!recurring.isActive) {
      throw new AppError("CONFLICT", "A recorrência está inativa");
    }
    if (recurring.endDate !== null && recurring.nextOccurrence > recurring.endDate) {
      this.#repository.advance(
        recurring.id,
        recurring.nextOccurrence,
        false,
        new Date().toISOString(),
      );
      throw new AppError("CONFLICT", "A recorrência já terminou");
    }

    const now = new Date().toISOString();
    let transaction: Transaction | undefined;

    this.#db.transaction(() => {
      transaction = this.#materialize(userId, recurring, recurring.nextOccurrence, now);
      this.#advance(recurring, now);
    });

    if (transaction === undefined) {
      throw new AppError("INTERNAL_ERROR", "Não foi possível materializar a recorrência");
    }

    return { recurring: this.get(userId, recurringId), transaction };
  }

  /** Materializa todas as ocorrências vencidas (usado no boot e no run-now em lote). */
  processDue(today = todayUtc()): ProcessDueResult {
    const due = this.#repository.due(today);
    const now = new Date().toISOString();
    let processed = 0;

    for (const recurring of due) {
      this.#db.transaction(() => {
        let cursor = recurring;
        let guard = 0;

        while (cursor.isActive && cursor.nextOccurrence <= today) {
          if (guard >= MAX_CATCH_UP_PER_RUN) break;

          if (cursor.endDate !== null && cursor.nextOccurrence > cursor.endDate) {
            this.#repository.advance(cursor.id, cursor.nextOccurrence, false, now);
            break;
          }

          this.#materialize(cursor.userId, cursor, cursor.nextOccurrence, now);
          processed++;

          const next = nextOccurrence(cursor.nextOccurrence, cursor);
          const isActive = cursor.endDate === null || next <= cursor.endDate;
          this.#repository.advance(cursor.id, next, isActive, now);

          cursor = { ...cursor, nextOccurrence: next, isActive };
          guard++;
        }
      });
    }

    return { processed, recurrings: due.length };
  }

  upcoming(userId: string, days = 30, limit = 20): UpcomingOccurrence[] {
    const to = addDays(todayUtc(), days);
    const occurrences: UpcomingOccurrence[] = [];

    for (const recurring of this.#repository.list(userId, false)) {
      let cursor = recurring.nextOccurrence;
      let guard = 0;

      while (cursor <= to && guard < 1000) {
        if (recurring.endDate !== null && cursor > recurring.endDate) break;

        occurrences.push({
          recurringId: recurring.id,
          accountId: recurring.accountId,
          categoryId: recurring.categoryId,
          type: recurring.type,
          amountMinor: recurring.amountMinor,
          currencyCode: recurring.currencyCode,
          description: recurring.description,
          occurrenceDate: cursor,
        });

        cursor = nextOccurrence(cursor, recurring);
        guard++;
      }
    }

    return occurrences
      .sort((left, right) =>
        left.occurrenceDate.localeCompare(right.occurrenceDate) ||
        (left.description ?? "").localeCompare(right.description ?? "") ||
        left.recurringId.localeCompare(right.recurringId)
      )
      .slice(0, limit);
  }

  #materialize(
    userId: string,
    recurring: RecurringTransaction,
    occurrenceDate: string,
    now: string,
  ): Transaction {
    const existing = this.#repository.findOccurrence(recurring.id, occurrenceDate);
    if (existing) {
      const transaction = this.#transactions.findById(userId, existing.transactionId);
      if (!transaction) {
        throw new AppError("INTERNAL_ERROR", "Ocorrência sem transação associada");
      }
      return transaction;
    }

    const transactionId = uuidv7();
    this.#transactions.insert({
      id: transactionId,
      accountId: recurring.accountId,
      categoryId: recurring.categoryId,
      transferGroupId: null,
      recurringTransactionId: recurring.id,
      type: recurring.type,
      amountMinor: recurring.amountMinor,
      currencyCode: recurring.currencyCode,
      description: recurring.description,
      transactionDate: occurrenceDate,
      isCleared: false,
      externalId: null,
      importHash: null,
      now,
    });
    this.#repository.insertOccurrence({
      id: uuidv7(),
      recurringTransactionId: recurring.id,
      occurrenceDate,
      transactionId,
      now,
    });

    const transaction = this.#transactions.findById(userId, transactionId);
    if (!transaction) {
      throw new AppError("INTERNAL_ERROR", "Transação da recorrência não encontrada");
    }
    return transaction;
  }

  #advance(recurring: RecurringTransaction, now: string): void {
    const next = nextOccurrence(recurring.nextOccurrence, recurring);
    const isActive = recurring.endDate === null || next <= recurring.endDate;
    this.#repository.advance(recurring.id, next, isActive, now);
  }

  #requireActiveAccount(userId: string, accountId: string): Account {
    const account = this.#accounts.findById(userId, accountId);
    if (!account) {
      throw new AppError("NOT_FOUND", "Conta não encontrada");
    }
    if (!account.isActive) {
      throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
        details: [{ path: "accountId", message: "A conta está inativa" }],
      });
    }
    return account;
  }

  #requireAccountCurrency(account: Account, currencyCode: string | undefined): string {
    const resolved = currencyCode ?? account.currencyCode;
    if (resolved !== account.currencyCode) {
      throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
        details: [{
          path: "currencyCode",
          message: "A moeda da recorrência precisa ser a mesma da conta",
        }],
      });
    }
    return resolved;
  }

  #requireCategory(userId: string, categoryId: string, type: RecurringType): Category {
    const category = this.#categories.findById(userId, categoryId);
    if (!category || !category.isActive) {
      throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
        details: [{ path: "categoryId", message: "Categoria não encontrada ou inativa" }],
      });
    }
    if (category.type !== type) {
      throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
        details: [{
          path: "categoryId",
          message: `A categoria precisa ser do tipo ${type}`,
        }],
      });
    }
    return category;
  }

  #assertDateRange(startDate: string, endDate: string | null): void {
    if (endDate !== null && endDate < startDate) {
      throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
        details: [{
          path: "endDate",
          message: "A data final precisa ser igual ou posterior à data inicial",
        }],
      });
    }
  }
}

function normalizeSchedule(
  input: {
    readonly frequency: RecurringFrequency;
    readonly interval: number;
    readonly dayOfMonth?: number | null;
    readonly endDate?: string | null;
  },
  startDate: string,
): RecurringSchedule {
  return {
    frequency: input.frequency,
    interval: input.interval,
    dayOfMonth: resolveDayOfMonth(input.frequency, input.dayOfMonth ?? null, startDate),
    startDate,
    endDate: input.endDate ?? null,
  };
}

function resolveDayOfMonth(
  frequency: RecurringFrequency,
  dayOfMonth: number | null,
  startDate: string,
): number | null {
  if (frequency === "daily" || frequency === "weekly") {
    return null;
  }
  return dayOfMonth ?? dayOfMonthOf(startDate);
}

/** Próxima data após `date`, respeitando o dia-alvo fixo das recorrências mensais. */
export function nextOccurrence(
  date: string,
  schedule: Pick<RecurringSchedule, "frequency" | "interval" | "dayOfMonth">,
): string {
  switch (schedule.frequency) {
    case "daily":
      return addDays(date, schedule.interval);
    case "weekly":
      return addDays(date, schedule.interval * 7);
    case "monthly":
      return addMonthsWithDay(
        date,
        schedule.interval,
        schedule.dayOfMonth ?? dayOfMonthOf(date),
      );
    case "yearly":
      return addMonthsWithDay(
        date,
        schedule.interval * 12,
        schedule.dayOfMonth ?? dayOfMonthOf(date),
      );
  }
}

function firstOccurrenceOnOrAfter(schedule: RecurringSchedule, target: string): string {
  let cursor = schedule.startDate;
  let guard = 0;

  while (cursor < target && guard < 10_000) {
    const next = nextOccurrence(cursor, schedule);
    if (next <= cursor) break;
    cursor = next;
    guard++;
  }

  return cursor;
}

function normalizeDescription(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
