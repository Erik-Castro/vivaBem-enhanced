import type { AppDatabase } from "../../db/client.ts";

export const ACCOUNT_TYPES = [
  "checking",
  "savings",
  "credit_card",
  "investment",
  "cash",
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface CreditCardDetails {
  readonly closingDay: number;
  readonly dueDay: number;
  readonly limitMinor: number;
}

export interface Account {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly type: AccountType;
  readonly currencyCode: string;
  readonly isActive: boolean;
  readonly creditCard: CreditCardDetails | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AccountBalance {
  readonly accountId: string;
  readonly currencyCode: string;
  readonly balanceMinor: number;
  readonly clearedBalanceMinor: number;
  readonly transactionCount: number;
  /** Limite disponível em cartões; `null` nos demais tipos. */
  readonly availableCreditMinor: number | null;
}

interface AccountRow {
  id: string;
  user_id: string;
  name: string;
  type: AccountType;
  currency_code: string;
  is_active: number;
  created_at: string;
  updated_at: string;
  closing_day: number | null;
  due_day: number | null;
  limit_minor: number | null;
}

interface BalanceRow {
  balance_minor: number | null;
  cleared_balance_minor: number | null;
  transaction_count: number;
}

export interface CreateAccountRecord {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly type: AccountType;
  readonly currencyCode: string;
  readonly now: string;
}

export interface UpdateAccountRecord {
  readonly id: string;
  readonly name: string;
  readonly currencyCode: string;
  readonly isActive: boolean;
  readonly now: string;
}

const SELECT_ACCOUNT = `
  SELECT a.*, c.closing_day, c.due_day, c.limit_minor
  FROM accounts a
  LEFT JOIN credit_card_details c ON c.account_id = a.id
`;

/** Acesso às contas e aos detalhes de cartão, sempre escopado por usuário. */
export class AccountsRepository {
  constructor(private readonly db: AppDatabase) {}

  list(userId: string, includeInactive = false): Account[] {
    const sql = `${SELECT_ACCOUNT}
      WHERE a.user_id = ?${includeInactive ? "" : " AND a.is_active = 1"}
      ORDER BY a.is_active DESC, a.name COLLATE NOCASE ASC`;

    return this.db
      .prepare<[string], AccountRow>(sql)
      .all(userId)
      .map(mapAccount);
  }

  findById(userId: string, accountId: string): Account | undefined {
    const row = this.db
      .prepare<[string, string], AccountRow>(
        `${SELECT_ACCOUNT} WHERE a.id = ? AND a.user_id = ?`,
      )
      .get(accountId, userId);
    return row ? mapAccount(row) : undefined;
  }

  findActiveByName(userId: string, name: string, excludeId?: string): string | undefined {
    const params: unknown[] = [userId, name];
    let sql = "SELECT id FROM accounts WHERE user_id = ? AND name = ? AND is_active = 1";
    if (excludeId !== undefined) {
      sql += " AND id <> ?";
      params.push(excludeId);
    }

    const row = this.db
      .prepare<unknown[], { id: string }>(`${sql} LIMIT 1`)
      .get(...params);
    return row?.id;
  }

  /** Deve ser chamado dentro de uma transação. */
  create(record: CreateAccountRecord): void {
    this.db
      .prepare<[string, string, string, string, string, string, string]>(
        `INSERT INTO accounts
           (id, user_id, name, type, currency_code, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.userId,
        record.name,
        record.type,
        record.currencyCode,
        record.now,
        record.now,
      );
  }

  /** Deve ser chamado dentro de uma transação. */
  upsertCreditCardDetails(accountId: string, details: CreditCardDetails): void {
    this.db
      .prepare<[string, number, number, number]>(
        `INSERT INTO credit_card_details (account_id, closing_day, due_day, limit_minor)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (account_id) DO UPDATE SET
           closing_day = excluded.closing_day,
           due_day = excluded.due_day,
           limit_minor = excluded.limit_minor`,
      )
      .run(accountId, details.closingDay, details.dueDay, details.limitMinor);
  }

  update(record: UpdateAccountRecord): void {
    this.db
      .prepare<[string, string, number, string, string]>(
        `UPDATE accounts
         SET name = ?, currency_code = ?, is_active = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        record.name,
        record.currencyCode,
        record.isActive ? 1 : 0,
        record.now,
        record.id,
      );
  }

  deactivate(accountId: string, now: string): void {
    this.db
      .prepare<[string, string]>(
        "UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ?",
      )
      .run(now, accountId);
  }

  hasTransactions(accountId: string): boolean {
    const row = this.db
      .prepare<[string], { found: number }>(
        "SELECT EXISTS(SELECT 1 FROM transactions WHERE account_id = ?) AS found",
      )
      .get(accountId);
    return row?.found === 1;
  }

  balance(account: Account): AccountBalance {
    const row = this.db
      .prepare<[string], BalanceRow>(
        `SELECT
           COALESCE(SUM(
             CASE type
               WHEN 'income' THEN amount_minor
               WHEN 'expense' THEN -amount_minor
               ELSE amount_minor
             END
           ), 0) AS balance_minor,
           COALESCE(SUM(
             CASE WHEN is_cleared = 1 THEN
               CASE type
                 WHEN 'income' THEN amount_minor
                 WHEN 'expense' THEN -amount_minor
                 ELSE amount_minor
               END
             ELSE 0 END
           ), 0) AS cleared_balance_minor,
           COUNT(*) AS transaction_count
         FROM transactions
         WHERE account_id = ? AND deleted_at IS NULL`,
      )
      .get(account.id);

    return {
      accountId: account.id,
      currencyCode: account.currencyCode,
      balanceMinor: row?.balance_minor ?? 0,
      clearedBalanceMinor: row?.cleared_balance_minor ?? 0,
      transactionCount: row?.transaction_count ?? 0,
      availableCreditMinor: account.creditCard === null
        ? null
        : account.creditCard.limitMinor + (row?.balance_minor ?? 0),
    };
  }
}

function mapAccount(row: AccountRow): Account {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    type: row.type,
    currencyCode: row.currency_code,
    isActive: row.is_active === 1,
    creditCard: row.closing_day === null || row.due_day === null ? null : {
      closingDay: row.closing_day,
      dueDay: row.due_day,
      limitMinor: row.limit_minor ?? 0,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
