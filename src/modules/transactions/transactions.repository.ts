import type { AppDatabase } from "../../db/client.ts";
import type { AccountType } from "../accounts/accounts.repository.ts";

export const TRANSACTION_TYPES = ["income", "expense", "transfer"] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export interface InstallmentInfo {
  readonly installmentNumber: number;
  readonly totalInstallments: number;
  readonly installmentGroupId: string;
}

export interface Transaction {
  readonly id: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly accountType: AccountType;
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly transferGroupId: string | null;
  readonly recurringTransactionId: string | null;
  readonly type: TransactionType;
  readonly amountMinor: number;
  readonly currencyCode: string;
  readonly description: string | null;
  readonly transactionDate: string;
  readonly isCleared: boolean;
  readonly externalId: string | null;
  readonly importHash: string | null;
  readonly installment: InstallmentInfo | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface TransactionRow {
  id: string;
  account_id: string;
  category_id: string | null;
  transfer_group_id: string | null;
  recurring_transaction_id: string | null;
  type: TransactionType;
  amount_minor: number;
  currency_code: string;
  description: string | null;
  transaction_date: string;
  is_cleared: number;
  external_id: string | null;
  import_hash: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  account_name: string;
  account_type: AccountType;
  category_name: string | null;
  installment_number: number | null;
  total_installments: number | null;
  installment_group_id: string | null;
}

export interface CreateTransactionRecord {
  readonly id: string;
  readonly accountId: string;
  readonly categoryId: string | null;
  readonly transferGroupId: string | null;
  /** Presente quando a transação foi materializada por uma recorrência. */
  readonly recurringTransactionId?: string | null;
  readonly type: TransactionType;
  readonly amountMinor: number;
  readonly currencyCode: string;
  readonly description: string | null;
  readonly transactionDate: string;
  readonly isCleared: boolean;
  readonly externalId: string | null;
  readonly importHash: string | null;
  readonly now: string;
}

export interface CreateInstallmentRecord {
  readonly id: string;
  readonly transactionId: string;
  readonly installmentNumber: number;
  readonly totalInstallments: number;
  readonly installmentGroupId: string;
}

export interface UpdateTransactionRecord {
  readonly id: string;
  readonly categoryId: string | null;
  readonly amountMinor: number;
  readonly description: string | null;
  readonly transactionDate: string;
  readonly isCleared: boolean;
  readonly now: string;
}

export interface TransactionFilters {
  readonly accountId?: string;
  readonly categoryId?: string;
  readonly type?: TransactionType;
  readonly from?: string;
  readonly to?: string;
  readonly isCleared?: boolean;
}

export interface TransactionListFilters extends TransactionFilters {
  readonly limit: number;
  readonly offset: number;
}

export interface TransactionList {
  readonly items: Transaction[];
  readonly hasMore: boolean;
}

export interface SummaryRow {
  readonly currency_code: string;
  readonly type: "income" | "expense";
  readonly category_id: string | null;
  readonly category_name: string | null;
  readonly total: number;
}

const SELECT_TRANSACTION = `
  SELECT t.*, a.name AS account_name, a.type AS account_type,
         c.name AS category_name,
         cct.installment_number, cct.total_installments, cct.installment_group_id
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN credit_card_transactions cct ON cct.transaction_id = t.id
`;

/** Acesso ao livro-razão, sempre escopado pelo usuário dono da conta. */
export class TransactionsRepository {
  constructor(private readonly db: AppDatabase) {}

  insert(record: CreateTransactionRecord): void {
    this.db
      .prepare<
        [
          string,
          string,
          string | null,
          string | null,
          TransactionType,
          number,
          string,
          string | null,
          string,
          number,
          string | null,
          string | null,
          string,
          string,
          string | null,
        ]
      >(
        `INSERT INTO transactions
           (id, account_id, category_id, transfer_group_id, type, amount_minor,
            currency_code, description, transaction_date, is_cleared, external_id,
            import_hash, created_at, updated_at, recurring_transaction_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.accountId,
        record.categoryId,
        record.transferGroupId,
        record.type,
        record.amountMinor,
        record.currencyCode,
        record.description,
        record.transactionDate,
        record.isCleared ? 1 : 0,
        record.externalId,
        record.importHash,
        record.now,
        record.now,
        record.recurringTransactionId ?? null,
      );
  }

  insertInstallment(record: CreateInstallmentRecord): void {
    this.db
      .prepare<[string, string, number, number, string]>(
        `INSERT INTO credit_card_transactions
           (id, transaction_id, installment_number, total_installments, installment_group_id)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.transactionId,
        record.installmentNumber,
        record.totalInstallments,
        record.installmentGroupId,
      );
  }

  findById(userId: string, transactionId: string): Transaction | undefined {
    const row = this.db
      .prepare<[string, string], TransactionRow>(
        `${SELECT_TRANSACTION}
         WHERE t.id = ? AND a.user_id = ? AND t.deleted_at IS NULL`,
      )
      .get(transactionId, userId);
    return row ? mapTransaction(row) : undefined;
  }

  list(userId: string, filters: TransactionListFilters): TransactionList {
    const { where, params } = buildFilters(userId, filters);
    const rows = this.db
      .prepare<unknown[], TransactionRow>(
        `${SELECT_TRANSACTION}
         WHERE ${where}
         ORDER BY t.transaction_date DESC, t.created_at DESC, t.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, filters.limit + 1, filters.offset);

    return {
      items: rows.slice(0, filters.limit).map(mapTransaction),
      hasMore: rows.length > filters.limit,
    };
  }

  update(record: UpdateTransactionRecord): void {
    this.db
      .prepare<[string | null, number, string | null, string, number, string, string]>(
        `UPDATE transactions
         SET category_id = ?, amount_minor = ?, description = ?, transaction_date = ?,
             is_cleared = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        record.categoryId,
        record.amountMinor,
        record.description,
        record.transactionDate,
        record.isCleared ? 1 : 0,
        record.now,
        record.id,
      );
  }

  /** Mantém as duas pernas da transferência coerentes. */
  updateTransferGroup(
    userId: string,
    transferGroupId: string,
    patch: {
      readonly description: string | null;
      readonly transactionDate: string;
      readonly isCleared: boolean;
      readonly now: string;
    },
  ): void {
    this.db
      .prepare<[string | null, string, number, string, string, string]>(
        `UPDATE transactions
         SET description = ?, transaction_date = ?, is_cleared = ?, updated_at = ?
         WHERE transfer_group_id = ? AND deleted_at IS NULL
           AND account_id IN (SELECT id FROM accounts WHERE user_id = ?)`,
      )
      .run(
        patch.description,
        patch.transactionDate,
        patch.isCleared ? 1 : 0,
        patch.now,
        transferGroupId,
        userId,
      );
  }

  softDelete(transactionId: string, now: string): void {
    this.db
      .prepare<[string, string, string]>(
        "UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
      )
      .run(now, now, transactionId);
  }

  softDeleteTransferGroup(userId: string, transferGroupId: string, now: string): void {
    this.db
      .prepare<[string, string, string, string]>(
        `UPDATE transactions
         SET deleted_at = ?, updated_at = ?
         WHERE transfer_group_id = ? AND deleted_at IS NULL
           AND account_id IN (SELECT id FROM accounts WHERE user_id = ?)`,
      )
      .run(now, now, transferGroupId, userId);
  }

  softDeleteInstallmentGroup(userId: string, installmentGroupId: string, now: string): void {
    this.db
      .prepare<[string, string, string, string]>(
        `UPDATE transactions
         SET deleted_at = ?, updated_at = ?
         WHERE deleted_at IS NULL AND id IN (
           SELECT t.id
           FROM transactions t
           JOIN credit_card_transactions cct ON cct.transaction_id = t.id
           JOIN accounts a ON a.id = t.account_id
           WHERE cct.installment_group_id = ? AND a.user_id = ?
         )`,
      )
      .run(now, now, installmentGroupId, userId);
  }

  summary(userId: string, filters: TransactionFilters): SummaryRow[] {
    const { where, params } = buildFilters(userId, filters);

    return this.db
      .prepare<unknown[], SummaryRow>(
        `SELECT t.currency_code, t.type, t.category_id, c.name AS category_name,
                SUM(t.amount_minor) AS total
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE ${where} AND t.type IN ('income', 'expense')
         GROUP BY t.currency_code, t.type, t.category_id, c.name
         ORDER BY t.currency_code ASC, t.type ASC, c.name COLLATE NOCASE ASC`,
      )
      .all(...params);
  }
}

function buildFilters(
  userId: string,
  filters: TransactionFilters,
): { where: string; params: unknown[] } {
  const conditions = ["a.user_id = ?", "t.deleted_at IS NULL"];
  const params: unknown[] = [userId];

  if (filters.accountId !== undefined) {
    conditions.push("t.account_id = ?");
    params.push(filters.accountId);
  }
  if (filters.categoryId !== undefined) {
    conditions.push("t.category_id = ?");
    params.push(filters.categoryId);
  }
  if (filters.type !== undefined) {
    conditions.push("t.type = ?");
    params.push(filters.type);
  }
  if (filters.from !== undefined) {
    conditions.push("t.transaction_date >= ?");
    params.push(filters.from);
  }
  if (filters.to !== undefined) {
    conditions.push("t.transaction_date <= ?");
    params.push(filters.to);
  }
  if (filters.isCleared !== undefined) {
    conditions.push("t.is_cleared = ?");
    params.push(filters.isCleared ? 1 : 0);
  }

  return { where: conditions.join(" AND "), params };
}

function mapTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    accountId: row.account_id,
    accountName: row.account_name,
    accountType: row.account_type,
    categoryId: row.category_id,
    categoryName: row.category_name,
    transferGroupId: row.transfer_group_id,
    recurringTransactionId: row.recurring_transaction_id,
    type: row.type,
    amountMinor: row.amount_minor,
    currencyCode: row.currency_code,
    description: row.description,
    transactionDate: row.transaction_date,
    isCleared: row.is_cleared === 1,
    externalId: row.external_id,
    importHash: row.import_hash,
    installment: row.installment_group_id === null ? null : {
      installmentNumber: row.installment_number ?? 1,
      totalInstallments: row.total_installments ?? 1,
      installmentGroupId: row.installment_group_id,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
