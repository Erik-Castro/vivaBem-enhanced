import type { AppDatabase } from "../../db/client.ts";

export const RECURRING_FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;

export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

export const RECURRING_TYPES = ["income", "expense"] as const;

export type RecurringType = (typeof RECURRING_TYPES)[number];

export interface RecurringTransaction {
  readonly id: string;
  readonly userId: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly type: RecurringType;
  readonly amountMinor: number;
  readonly currencyCode: string;
  readonly description: string | null;
  readonly frequency: RecurringFrequency;
  readonly interval: number;
  readonly dayOfMonth: number | null;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly nextOccurrence: string;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface RecurringRow {
  id: string;
  user_id: string;
  account_id: string;
  category_id: string | null;
  type: RecurringType;
  amount_minor: number;
  currency_code: string;
  description: string | null;
  frequency: RecurringFrequency;
  interval: number;
  day_of_month: number | null;
  start_date: string;
  end_date: string | null;
  next_occurrence: string;
  is_active: number;
  created_at: string;
  updated_at: string;
  account_name: string;
  category_name: string | null;
}

export interface CreateRecurringRecord {
  readonly id: string;
  readonly userId: string;
  readonly accountId: string;
  readonly categoryId: string | null;
  readonly type: RecurringType;
  readonly amountMinor: number;
  readonly currencyCode: string;
  readonly description: string | null;
  readonly frequency: RecurringFrequency;
  readonly interval: number;
  readonly dayOfMonth: number | null;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly nextOccurrence: string;
  readonly isActive: boolean;
  readonly now: string;
}

export interface UpdateRecurringRecord {
  readonly id: string;
  readonly accountId: string;
  readonly categoryId: string | null;
  readonly type: RecurringType;
  readonly amountMinor: number;
  readonly currencyCode: string;
  readonly description: string | null;
  readonly frequency: RecurringFrequency;
  readonly interval: number;
  readonly dayOfMonth: number | null;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly nextOccurrence: string;
  readonly isActive: boolean;
  readonly now: string;
}

export interface RecurringOccurrence {
  readonly id: string;
  readonly recurringTransactionId: string;
  readonly occurrenceDate: string;
  readonly transactionId: string;
  readonly createdAt: string;
}

interface OccurrenceRow {
  id: string;
  recurring_transaction_id: string;
  occurrence_date: string;
  transaction_id: string;
  created_at: string;
}

export interface CreateOccurrenceRecord {
  readonly id: string;
  readonly recurringTransactionId: string;
  readonly occurrenceDate: string;
  readonly transactionId: string;
  readonly now: string;
}

const SELECT_RECURRING = `
  SELECT r.*, a.name AS account_name, c.name AS category_name
  FROM recurring_transactions r
  JOIN accounts a ON a.id = r.account_id
  LEFT JOIN categories c ON c.id = r.category_id
`;

/** Acesso às recorrências, sempre escopado pelo usuário. */
export class RecurringRepository {
  constructor(private readonly db: AppDatabase) {}

  list(userId: string, includeInactive = false): RecurringTransaction[] {
    const sql = `${SELECT_RECURRING}
      WHERE r.user_id = ?${includeInactive ? "" : " AND r.is_active = 1"}
      ORDER BY r.is_active DESC, r.next_occurrence ASC, r.created_at ASC`;

    return this.db
      .prepare<[string], RecurringRow>(sql)
      .all(userId)
      .map(mapRecurring);
  }

  findById(userId: string, recurringId: string): RecurringTransaction | undefined {
    const row = this.db
      .prepare<[string, string], RecurringRow>(
        `${SELECT_RECURRING} WHERE r.id = ? AND r.user_id = ?`,
      )
      .get(recurringId, userId);
    return row ? mapRecurring(row) : undefined;
  }

  /** Recorrências ativas com ocorrência pendente até `date` (sem escopo de usuário). */
  due(date: string): RecurringTransaction[] {
    return this.db
      .prepare<[string], RecurringRow>(
        `${SELECT_RECURRING}
         WHERE r.is_active = 1 AND r.next_occurrence <= ?
         ORDER BY r.next_occurrence ASC, r.id ASC`,
      )
      .all(date)
      .map(mapRecurring);
  }

  create(record: CreateRecurringRecord): void {
    this.db
      .prepare<
        [
          string,
          string,
          string,
          string | null,
          RecurringType,
          number,
          string,
          string | null,
          RecurringFrequency,
          number,
          number | null,
          string,
          string | null,
          string,
          number,
          string,
          string,
        ]
      >(
        `INSERT INTO recurring_transactions
           (id, user_id, account_id, category_id, type, amount_minor, currency_code,
            description, frequency, interval, day_of_month, start_date, end_date,
            next_occurrence, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.userId,
        record.accountId,
        record.categoryId,
        record.type,
        record.amountMinor,
        record.currencyCode,
        record.description,
        record.frequency,
        record.interval,
        record.dayOfMonth,
        record.startDate,
        record.endDate,
        record.nextOccurrence,
        record.isActive ? 1 : 0,
        record.now,
        record.now,
      );
  }

  update(record: UpdateRecurringRecord): void {
    this.db
      .prepare<
        [
          string,
          string | null,
          RecurringType,
          number,
          string,
          string | null,
          RecurringFrequency,
          number,
          number | null,
          string,
          string | null,
          string,
          number,
          string,
          string,
        ]
      >(
        `UPDATE recurring_transactions
         SET account_id = ?, category_id = ?, type = ?, amount_minor = ?, currency_code = ?,
             description = ?, frequency = ?, interval = ?, day_of_month = ?, start_date = ?,
             end_date = ?, next_occurrence = ?, is_active = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        record.accountId,
        record.categoryId,
        record.type,
        record.amountMinor,
        record.currencyCode,
        record.description,
        record.frequency,
        record.interval,
        record.dayOfMonth,
        record.startDate,
        record.endDate,
        record.nextOccurrence,
        record.isActive ? 1 : 0,
        record.now,
        record.id,
      );
  }

  deactivate(userId: string, recurringId: string, now: string): void {
    this.db
      .prepare<[string, string, string]>(
        `UPDATE recurring_transactions
         SET is_active = 0, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      )
      .run(now, recurringId, userId);
  }

  advance(
    recurringId: string,
    nextOccurrence: string,
    isActive: boolean,
    now: string,
  ): void {
    this.db
      .prepare<[string, number, string, string]>(
        `UPDATE recurring_transactions
         SET next_occurrence = ?, is_active = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(nextOccurrence, isActive ? 1 : 0, now, recurringId);
  }

  findOccurrence(
    recurringId: string,
    occurrenceDate: string,
  ): RecurringOccurrence | undefined {
    const row = this.db
      .prepare<[string, string], OccurrenceRow>(
        `SELECT * FROM recurring_occurrences
         WHERE recurring_transaction_id = ? AND occurrence_date = ?`,
      )
      .get(recurringId, occurrenceDate);
    return row ? mapOccurrence(row) : undefined;
  }

  insertOccurrence(record: CreateOccurrenceRecord): void {
    this.db
      .prepare<[string, string, string, string, string]>(
        `INSERT INTO recurring_occurrences
           (id, recurring_transaction_id, occurrence_date, transaction_id, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.recurringTransactionId,
        record.occurrenceDate,
        record.transactionId,
        record.now,
      );
  }
}

function mapRecurring(row: RecurringRow): RecurringTransaction {
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    accountName: row.account_name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    type: row.type,
    amountMinor: row.amount_minor,
    currencyCode: row.currency_code,
    description: row.description,
    frequency: row.frequency,
    interval: row.interval,
    dayOfMonth: row.day_of_month,
    startDate: row.start_date,
    endDate: row.end_date,
    nextOccurrence: row.next_occurrence,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOccurrence(row: OccurrenceRow): RecurringOccurrence {
  return {
    id: row.id,
    recurringTransactionId: row.recurring_transaction_id,
    occurrenceDate: row.occurrence_date,
    transactionId: row.transaction_id,
    createdAt: row.created_at,
  };
}
