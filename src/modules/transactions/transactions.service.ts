import type { AppDatabase } from "../../db/client.ts";
import { AppError } from "../../http/errors.ts";
import { addMonthsClamped } from "../../shared/utils/date.ts";
import { uuidv7 } from "../../shared/utils/uuid.ts";
import type { EventPublisher } from "../../events/event-publisher.ts";
import type { EventType } from "../../events/events.types.ts";
import type { Account, AccountsRepository } from "../accounts/accounts.repository.ts";
import type { CategoriesRepository, Category } from "../categories/categories.repository.ts";
import type {
  SummaryRow,
  Transaction,
  TransactionFilters,
  TransactionList,
  TransactionsRepository,
} from "./transactions.repository.ts";

export interface CreateTransactionInput {
  readonly accountId: string;
  readonly categoryId?: string | null;
  readonly type: "income" | "expense";
  readonly amountMinor: number;
  readonly currencyCode?: string;
  readonly description?: string | null;
  readonly transactionDate: string;
  readonly isCleared?: boolean;
  readonly installments?: { readonly totalInstallments: number };
}

export interface TransferInput {
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly amountMinor: number;
  readonly description?: string | null;
  readonly transactionDate: string;
  readonly isCleared?: boolean;
}

export interface UpdateTransactionInput {
  readonly categoryId?: string | null;
  readonly amountMinor?: number;
  readonly description?: string | null;
  readonly transactionDate?: string;
  readonly isCleared?: boolean;
}

export interface CategorySummary {
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly type: "income" | "expense";
  readonly amountMinor: number;
}

export interface CurrencySummary {
  readonly currencyCode: string;
  readonly incomeMinor: number;
  readonly expenseMinor: number;
  readonly netMinor: number;
  readonly byCategory: CategorySummary[];
}

export interface TransactionSummary {
  readonly period: {
    readonly from: string | null;
    readonly to: string | null;
  };
  readonly currencies: CurrencySummary[];
}

export interface TransferResult {
  readonly transferGroupId: string;
  readonly from: Transaction;
  readonly to: Transaction;
}

export interface TransactionsServiceDependencies {
  readonly db: AppDatabase;
  readonly repository: TransactionsRepository;
  readonly accounts: AccountsRepository;
  readonly categories: CategoriesRepository;
  readonly events?: EventPublisher;
}

export class TransactionsService {
  readonly #db: AppDatabase;
  readonly #repository: TransactionsRepository;
  readonly #accounts: AccountsRepository;
  readonly #categories: CategoriesRepository;
  readonly #events: EventPublisher | null;

  constructor(dependencies: TransactionsServiceDependencies) {
    this.#db = dependencies.db;
    this.#repository = dependencies.repository;
    this.#accounts = dependencies.accounts;
    this.#categories = dependencies.categories;
    this.#events = dependencies.events ?? null;
  }

  list(
    userId: string,
    filters: TransactionFilters & { limit: number; offset: number },
  ): TransactionList {
    return this.#repository.list(userId, filters);
  }

  get(userId: string, transactionId: string): Transaction {
    const transaction = this.#repository.findById(userId, transactionId);
    if (!transaction) {
      throw new AppError("NOT_FOUND", "Transação não encontrada");
    }
    return transaction;
  }

  create(userId: string, input: CreateTransactionInput): Transaction[] {
    const account = this.#requireActiveAccount(userId, input.accountId);
    const currencyCode = input.currencyCode ?? account.currencyCode;

    if (currencyCode !== account.currencyCode) {
      throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
        details: [{
          path: "currencyCode",
          message: "A moeda da transação precisa ser a mesma da conta",
        }],
      });
    }

    const categoryId = input.categoryId ?? null;
    if (categoryId !== null) {
      this.#requireCategory(userId, categoryId, input.type);
    }

    const totalInstallments = input.installments?.totalInstallments ?? 1;
    if (totalInstallments > 1) {
      if (account.type !== "credit_card") {
        throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
          details: [{
            path: "installments",
            message: "Parcelamento só é permitido em contas de cartão de crédito",
          }],
        });
      }
      if (input.amountMinor < totalInstallments) {
        throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
          details: [{
            path: "amountMinor",
            message: "O valor total precisa ser maior ou igual ao número de parcelas",
          }],
        });
      }
    }

    const now = new Date().toISOString();
    const createdIds: string[] = [];
    const description = normalizeDescription(input.description);

    if (totalInstallments === 1) {
      const transactionId = uuidv7();
      this.#repository.insert({
        id: transactionId,
        accountId: account.id,
        categoryId,
        transferGroupId: null,
        type: input.type,
        amountMinor: input.amountMinor,
        currencyCode,
        description,
        transactionDate: input.transactionDate,
        isCleared: input.isCleared ?? false,
        externalId: null,
        importHash: null,
        now,
      });
      createdIds.push(transactionId);
      this.#publish("finance.transaction.created", userId, transactionId, {
        transactionId,
        accountId: account.id,
        categoryId,
        type: input.type,
        amountMinor: input.amountMinor,
        currencyCode,
        transactionDate: input.transactionDate,
        description,
      });
    } else {
      const installmentGroupId = uuidv7();
      const amounts = splitInstallments(input.amountMinor, totalInstallments);

      this.#db.transaction(() => {
        for (const [index, amount] of amounts.entries()) {
          const transactionId = uuidv7();
          this.#repository.insert({
            id: transactionId,
            accountId: account.id,
            categoryId,
            transferGroupId: null,
            type: input.type,
            amountMinor: amount,
            currencyCode,
            description,
            transactionDate: addMonthsClamped(input.transactionDate, index),
            isCleared: false,
            externalId: null,
            importHash: null,
            now,
          });
          this.#repository.insertInstallment({
            id: uuidv7(),
            transactionId,
            installmentNumber: index + 1,
            totalInstallments,
            installmentGroupId,
          });
          createdIds.push(transactionId);
          this.#publish("finance.transaction.created", userId, transactionId, {
            transactionId,
            accountId: account.id,
            categoryId,
            type: input.type,
            amountMinor: amount,
            currencyCode,
            transactionDate: addMonthsClamped(input.transactionDate, index),
            description,
            installmentNumber: index + 1,
            totalInstallments,
          });
        }
      });
    }

    return createdIds.map((id) => this.get(userId, id));
  }

  transfer(userId: string, input: TransferInput): TransferResult {
    const from = this.#requireActiveAccount(userId, input.fromAccountId);
    const to = this.#requireActiveAccount(userId, input.toAccountId);

    if (from.id === to.id) {
      throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
        details: [{
          path: "toAccountId",
          message: "A conta de destino precisa ser diferente da origem",
        }],
      });
    }

    if (from.currencyCode !== to.currencyCode) {
      throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
        details: [{
          path: "toAccountId",
          message: "Transferências entre moedas diferentes ainda não são suportadas",
        }],
      });
    }

    const transferGroupId = uuidv7();
    const fromId = uuidv7();
    const toId = uuidv7();
    const now = new Date().toISOString();
    const description = normalizeDescription(input.description) ?? "Transferência";
    const isCleared = input.isCleared ?? true;

    this.#db.transaction(() => {
      this.#repository.insert({
        id: fromId,
        accountId: from.id,
        categoryId: null,
        transferGroupId,
        type: "transfer",
        amountMinor: -input.amountMinor,
        currencyCode: from.currencyCode,
        description,
        transactionDate: input.transactionDate,
        isCleared,
        externalId: null,
        importHash: null,
        now,
      });

      this.#repository.insert({
        id: toId,
        accountId: to.id,
        categoryId: null,
        transferGroupId,
        type: "transfer",
        amountMinor: input.amountMinor,
        currencyCode: to.currencyCode,
        description,
        transactionDate: input.transactionDate,
        isCleared,
        externalId: null,
        importHash: null,
        now,
      });

      this.#events?.publish({
        type: "finance.transfer.created",
        aggregateType: "transfer",
        aggregateId: transferGroupId,
        userId,
        payload: {
          transferGroupId,
          fromTransactionId: fromId,
          toTransactionId: toId,
          fromAccountId: from.id,
          toAccountId: to.id,
          amountMinor: input.amountMinor,
          currencyCode: from.currencyCode,
          transactionDate: input.transactionDate,
          description,
        },
      });
    });

    return {
      transferGroupId,
      from: this.get(userId, fromId),
      to: this.get(userId, toId),
    };
  }

  update(userId: string, transactionId: string, input: UpdateTransactionInput): Transaction {
    const current = this.get(userId, transactionId);
    const now = new Date().toISOString();

    if (current.type === "transfer") {
      if (input.categoryId !== undefined || input.amountMinor !== undefined) {
        throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
          details: [{
            path: "amountMinor",
            message: "Transferências não aceitam alteração de valor ou categoria",
          }],
        });
      }

      this.#repository.updateTransferGroup(userId, current.transferGroupId ?? "", {
        description: input.description === undefined
          ? current.description
          : normalizeDescription(input.description),
        transactionDate: input.transactionDate ?? current.transactionDate,
        isCleared: input.isCleared ?? current.isCleared,
        now,
      });

      this.#publish("finance.transaction.updated", userId, transactionId, {
        transactionId,
        transferGroupId: current.transferGroupId,
        description: input.description === undefined
          ? current.description
          : normalizeDescription(input.description),
        transactionDate: input.transactionDate ?? current.transactionDate,
        isCleared: input.isCleared ?? current.isCleared,
      });

      return this.get(userId, transactionId);
    }

    if (
      current.installment !== null &&
      (input.amountMinor !== undefined || input.transactionDate !== undefined)
    ) {
      throw new AppError(
        "CONFLICT",
        "Parcelas não podem ter valor ou data alterados individualmente",
      );
    }

    let categoryId = current.categoryId;
    if (input.categoryId !== undefined) {
      if (input.categoryId === null) {
        categoryId = null;
      } else {
        const type = current.type === "income" ? "income" : "expense";
        this.#requireCategory(userId, input.categoryId, type);
        categoryId = input.categoryId;
      }
    }

    this.#repository.update({
      id: transactionId,
      categoryId,
      amountMinor: input.amountMinor ?? current.amountMinor,
      description: input.description === undefined
        ? current.description
        : normalizeDescription(input.description),
      transactionDate: input.transactionDate ?? current.transactionDate,
      isCleared: input.isCleared ?? current.isCleared,
      now,
    });

    this.#publish("finance.transaction.updated", userId, transactionId, {
      transactionId,
      categoryId,
      amountMinor: input.amountMinor ?? current.amountMinor,
      description: input.description === undefined
        ? current.description
        : normalizeDescription(input.description),
      transactionDate: input.transactionDate ?? current.transactionDate,
      isCleared: input.isCleared ?? current.isCleared,
    });

    return this.get(userId, transactionId);
  }

  delete(userId: string, transactionId: string): void {
    const current = this.get(userId, transactionId);
    const now = new Date().toISOString();

    if (current.transferGroupId !== null) {
      this.#repository.softDeleteTransferGroup(userId, current.transferGroupId, now);
      this.#publish("finance.transaction.deleted", userId, transactionId, {
        transactionId,
        transferGroupId: current.transferGroupId,
      });
      return;
    }

    if (current.installment !== null) {
      this.#repository.softDeleteInstallmentGroup(
        userId,
        current.installment.installmentGroupId,
        now,
      );
      this.#publish("finance.transaction.deleted", userId, transactionId, {
        transactionId,
        installmentGroupId: current.installment.installmentGroupId,
      });
      return;
    }

    this.#repository.softDelete(transactionId, now);
    this.#publish("finance.transaction.deleted", userId, transactionId, { transactionId });
  }

  clear(userId: string, transactionId: string): Transaction {
    const current = this.get(userId, transactionId);
    if (current.isCleared) return current;

    const now = new Date().toISOString();

    if (current.transferGroupId !== null) {
      this.#repository.updateTransferGroup(userId, current.transferGroupId, {
        description: current.description,
        transactionDate: current.transactionDate,
        isCleared: true,
        now,
      });
    } else {
      this.#repository.update({
        id: transactionId,
        categoryId: current.categoryId,
        amountMinor: current.amountMinor,
        description: current.description,
        transactionDate: current.transactionDate,
        isCleared: true,
        now,
      });
    }

    this.#publish("finance.transaction.cleared", userId, transactionId, {
      transactionId,
      transferGroupId: current.transferGroupId,
    });

    return this.get(userId, transactionId);
  }

  summary(userId: string, filters: TransactionFilters): TransactionSummary {
    const rows = this.#repository.summary(userId, filters);
    return aggregateSummary(rows, filters);
  }

  #publish(
    type: EventType,
    userId: string,
    transactionId: string,
    payload: Record<string, unknown>,
  ): void {
    this.#events?.publish({
      type,
      aggregateType: "transaction",
      aggregateId: transactionId,
      userId,
      payload,
    });
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

  #requireCategory(userId: string, categoryId: string, type: "income" | "expense"): Category {
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
}

function splitInstallments(totalMinor: number, totalInstallments: number): number[] {
  const base = Math.floor(totalMinor / totalInstallments);
  const remainder = totalMinor % totalInstallments;

  return Array.from(
    { length: totalInstallments },
    (_, index) => base + (index < remainder ? 1 : 0),
  );
}

function normalizeDescription(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function aggregateSummary(
  rows: readonly SummaryRow[],
  filters: TransactionFilters,
): TransactionSummary {
  const currencies = new Map<
    string,
    {
      incomeMinor: number;
      expenseMinor: number;
      byCategory: Map<string, CategorySummary>;
    }
  >();

  for (const row of rows) {
    const currency = currencies.get(row.currency_code) ??
      { incomeMinor: 0, expenseMinor: 0, byCategory: new Map<string, CategorySummary>() };

    if (row.type === "income") {
      currency.incomeMinor += row.total;
    } else {
      currency.expenseMinor += row.total;
    }

    const key = `${row.category_id ?? "null"}:${row.type}`;
    const existing = currency.byCategory.get(key);
    if (existing) {
      currency.byCategory.set(key, {
        ...existing,
        amountMinor: existing.amountMinor + row.total,
      });
    } else {
      currency.byCategory.set(key, {
        categoryId: row.category_id,
        categoryName: row.category_name,
        type: row.type,
        amountMinor: row.total,
      });
    }

    currencies.set(row.currency_code, currency);
  }

  return {
    period: {
      from: filters.from ?? null,
      to: filters.to ?? null,
    },
    currencies: [...currencies.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currencyCode, value]) => ({
        currencyCode,
        incomeMinor: value.incomeMinor,
        expenseMinor: value.expenseMinor,
        netMinor: value.incomeMinor - value.expenseMinor,
        byCategory: [...value.byCategory.values()].sort((left, right) => {
          if (left.type !== right.type) return left.type === "income" ? -1 : 1;
          return (left.categoryName ?? "").localeCompare(right.categoryName ?? "");
        }),
      })),
  };
}
