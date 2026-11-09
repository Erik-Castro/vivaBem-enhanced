import type { AppDatabase } from "../../db/client.ts";

export type ExportRecord = Record<string, unknown>;

export interface ExportTransactionCsvRow {
  readonly id: string;
  readonly transactionDate: string;
  readonly type: string;
  readonly amountMinor: number;
  readonly currencyCode: string;
  readonly accountName: string;
  readonly categoryName: string | null;
  readonly description: string | null;
  readonly isCleared: boolean;
  readonly externalId: string | null;
  readonly transferGroupId: string | null;
  readonly createdAt: string;
}

/** Colunas armazenadas como 0/1 que devem sair como booleanos no JSON. */
const BOOLEAN_COLUMNS = new Set([
  "is_active",
  "is_cleared",
  "email_verified",
  "is_read",
  "is_unlocked",
  "is_hidden",
  "replacement_used",
  "ai_enabled",
]);

/** Colunas TEXT que guardam JSON serializado. */
const JSON_COLUMNS = new Set(["days_of_week", "criteria_params"]);

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

function mapRecord(row: Record<string, unknown>): ExportRecord {
  const mapped: ExportRecord = {};

  for (const [key, value] of Object.entries(row)) {
    let next = value;

    if (BOOLEAN_COLUMNS.has(key) && typeof value === "number") {
      next = value === 1;
    } else if (JSON_COLUMNS.has(key) && typeof value === "string") {
      try {
        next = JSON.parse(value);
      } catch {
        next = value;
      }
    }

    mapped[snakeToCamel(key)] = next;
  }

  return mapped;
}

/**
 * Leitura de todos os domínios do usuário para exportação.
 *
 * As consultas são somente leitura e escopadas por `user_id`. Segredos
 * (hash de senha, hash de refresh token, vetores) nunca entram no bundle.
 */
export class ExportRepository {
  constructor(private readonly db: AppDatabase) {}

  user(userId: string): ExportRecord | null {
    const row = this.db
      .prepare<[string], Record<string, unknown>>(
        `SELECT id, name, avatar_url, subscription_tier, setup_completed_at,
                created_at, updated_at
         FROM user_profiles WHERE id = ?`,
      )
      .get(userId);
    return row ? mapRecord(row) : null;
  }

  credentials(userId: string): ExportRecord | null {
    const row = this.db
      .prepare<[string], Record<string, unknown>>(
        `SELECT email, password_algorithm, email_verified, last_login_at,
                created_at, updated_at
         FROM user_credentials WHERE user_id = ?`,
      )
      .get(userId);
    return row ? mapRecord(row) : null;
  }

  preferences(userId: string): ExportRecord | null {
    const row = this.db
      .prepare<[string], Record<string, unknown>>(
        `SELECT user_id, timezone, base_currency, locale, ai_enabled, updated_at
         FROM user_preferences WHERE user_id = ?`,
      )
      .get(userId);
    return row ? mapRecord(row) : null;
  }

  sessions(userId: string): ExportRecord[] {
    return this.rows(
      `SELECT id, token_family_id, rotated_from, ip_address, user_agent,
              expires_at, created_at, last_used_at, revoked_at
       FROM user_sessions WHERE user_id = ? ORDER BY created_at`,
      userId,
    );
  }

  accounts(userId: string): ExportRecord[] {
    return this.rows(
      `SELECT a.id, a.name, a.type, a.currency_code, a.is_active,
              a.created_at, a.updated_at,
              c.closing_day, c.due_day, c.limit_minor
       FROM accounts a
       LEFT JOIN credit_card_details c ON c.account_id = a.id
       WHERE a.user_id = ?
       ORDER BY a.created_at`,
      userId,
    );
  }

  categories(userId: string): ExportRecord[] {
    return this.rows(
      `SELECT id, parent_id, name, type, color, icon, is_active, created_at, updated_at
       FROM categories WHERE user_id = ? ORDER BY created_at`,
      userId,
    );
  }

  transactions(userId: string): ExportRecord[] {
    return this.rows(
      `SELECT t.id, t.account_id, t.category_id, t.transfer_group_id,
              t.recurring_transaction_id, t.type, t.amount_minor, t.currency_code,
              t.description, t.transaction_date, t.is_cleared, t.external_id,
              t.import_hash, t.deleted_at, t.created_at, t.updated_at,
              cct.installment_number, cct.total_installments, cct.installment_group_id
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN credit_card_transactions cct ON cct.transaction_id = t.id
       WHERE a.user_id = ?
       ORDER BY t.transaction_date, t.created_at, t.rowid`,
      userId,
    );
  }

  recurringTransactions(userId: string): ExportRecord[] {
    return this.rows(
      `SELECT * FROM recurring_transactions WHERE user_id = ? ORDER BY created_at`,
      userId,
    );
  }

  recurringOccurrences(userId: string): ExportRecord[] {
    return this.rows(
      `SELECT o.* FROM recurring_occurrences o
       JOIN recurring_transactions r ON r.id = o.recurring_transaction_id
       WHERE r.user_id = ?
       ORDER BY o.occurrence_date`,
      userId,
    );
  }

  budgets(userId: string): ExportRecord[] {
    return this.rows(
      `SELECT * FROM budgets WHERE user_id = ? ORDER BY created_at`,
      userId,
    );
  }

  goals(userId: string): ExportRecord[] {
    return this.rows(
      `SELECT * FROM goals WHERE user_id = ? ORDER BY created_at`,
      userId,
    );
  }

  goalContributions(userId: string): ExportRecord[] {
    return this.rows(
      `SELECT c.* FROM goal_contributions c
       JOIN goals g ON g.id = c.goal_id
       WHERE g.user_id = ?
       ORDER BY c.contribution_date, c.created_at`,
      userId,
    );
  }

  habits(userId: string): ExportRecord[] {
    return this.rows(
      `SELECT * FROM habits WHERE user_id = ? ORDER BY created_at`,
      userId,
    );
  }

  habitTriggers(userId: string): ExportRecord[] {
    return this.rows(
      `SELECT * FROM habit_triggers WHERE user_id = ? ORDER BY created_at`,
      userId,
    );
  }

  habitLogs(userId: string): ExportRecord[] {
    return this.rows(
      `SELECT l.* FROM habit_logs l
       JOIN habits h ON h.id = l.habit_id
       WHERE h.user_id = ?
       ORDER BY l.log_date, l.created_at`,
      userId,
    );
  }

  investments(userId: string): ExportRecord[] {
    return this.rows(
      `SELECT * FROM investments WHERE user_id = ? ORDER BY created_at`,
      userId,
    );
  }

  investmentTransactions(userId: string): ExportRecord[] {
    return this.rows(
      `SELECT it.* FROM investment_transactions it
       JOIN investments i ON i.id = it.investment_id
       WHERE i.user_id = ?
       ORDER BY it.operation_date, it.created_at, it.rowid`,
      userId,
    );
  }

  investmentQuotes(userId: string): ExportRecord[] {
    return this.rows(
      `SELECT q.* FROM investment_quotes q
       JOIN investments i ON i.id = q.investment_id
       WHERE i.user_id = ?
       ORDER BY q.quoted_at`,
      userId,
    );
  }

  achievements(userId: string): ExportRecord[] {
    return this.rows(
      `SELECT ua.achievement_id, a.title, a.category, a.points_reward,
              ua.current_progress, ua.is_unlocked, ua.unlocked_at,
              ua.created_at, ua.updated_at
       FROM user_achievements ua
       JOIN achievements a ON a.id = ua.achievement_id
       WHERE ua.user_id = ?
       ORDER BY ua.created_at`,
      userId,
    );
  }

  notifications(userId: string): ExportRecord[] {
    return this.rows(
      `SELECT id, title, message, category, severity, link, is_read, created_at
       FROM notifications WHERE user_id = ? ORDER BY created_at`,
      userId,
    );
  }

  insights(userId: string): ExportRecord[] {
    return this.rows(
      `SELECT id, category, severity, title, message, source_event, confidence,
              is_read, created_at
       FROM ai_insights WHERE user_id = ? ORDER BY created_at`,
      userId,
    );
  }

  insightFeedback(userId: string): ExportRecord[] {
    return this.rows(
      `SELECT id, insight_id, rating, comment, created_at
       FROM ai_feedback WHERE user_id = ? ORDER BY created_at`,
      userId,
    );
  }

  familyLinks(userId: string): ExportRecord[] {
    return this.rows(
      `SELECT id, requester_id, addressee_id, status, created_at, responded_at
       FROM family_links
       WHERE requester_id = ? OR addressee_id = ?
       ORDER BY created_at`,
      userId,
      userId,
    );
  }

  transactionCsvRows(userId: string): ExportTransactionCsvRow[] {
    return this.db
      .prepare<[string], Record<string, unknown>>(
        `SELECT t.id, t.transaction_date, t.type, t.amount_minor, t.currency_code,
                a.name AS account_name, c.name AS category_name, t.description,
                t.is_cleared, t.external_id, t.transfer_group_id, t.created_at
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE a.user_id = ? AND t.deleted_at IS NULL
         ORDER BY t.transaction_date, t.created_at, t.rowid`,
      )
      .all(userId)
      .map((row) => ({
        id: row.id as string,
        transactionDate: row.transaction_date as string,
        type: row.type as string,
        amountMinor: row.amount_minor as number,
        currencyCode: row.currency_code as string,
        accountName: row.account_name as string,
        categoryName: (row.category_name as string | null) ?? null,
        description: (row.description as string | null) ?? null,
        isCleared: row.is_cleared === 1,
        externalId: (row.external_id as string | null) ?? null,
        transferGroupId: (row.transfer_group_id as string | null) ?? null,
        createdAt: row.created_at as string,
      }));
  }

  private rows(sql: string, ...params: string[]): ExportRecord[] {
    return this.db
      .prepare<unknown[], Record<string, unknown>>(sql)
      .all(...params)
      .map(mapRecord);
  }
}
