import type { AppDatabase } from "../../db/client.ts";

export const BUDGET_PERIOD_TYPES = ["monthly", "yearly", "custom"] as const;

export type BudgetPeriodType = (typeof BUDGET_PERIOD_TYPES)[number];

export interface Budget {
  readonly id: string;
  readonly userId: string;
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly name: string;
  readonly limitMinor: number;
  readonly currencyCode: string;
  readonly periodType: BudgetPeriodType;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly alertThreshold: number;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface BudgetRow {
  id: string;
  user_id: string;
  category_id: string | null;
  name: string;
  limit_minor: number;
  currency_code: string;
  period_type: BudgetPeriodType;
  start_date: string;
  end_date: string | null;
  alert_threshold: number;
  is_active: number;
  created_at: string;
  updated_at: string;
  category_name: string | null;
}

export interface CreateBudgetRecord {
  readonly id: string;
  readonly userId: string;
  readonly categoryId: string | null;
  readonly name: string;
  readonly limitMinor: number;
  readonly currencyCode: string;
  readonly periodType: BudgetPeriodType;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly alertThreshold: number;
  readonly isActive: boolean;
  readonly now: string;
}

export interface UpdateBudgetRecord {
  readonly id: string;
  readonly categoryId: string | null;
  readonly name: string;
  readonly limitMinor: number;
  readonly currencyCode: string;
  readonly periodType: BudgetPeriodType;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly alertThreshold: number;
  readonly isActive: boolean;
  readonly now: string;
}

const SELECT_BUDGET = `
  SELECT b.*, c.name AS category_name
  FROM budgets b
  LEFT JOIN categories c ON c.id = b.category_id
`;

/** Acesso aos orçamentos, sempre escopado pelo usuário. */
export class BudgetsRepository {
  constructor(private readonly db: AppDatabase) {}

  list(userId: string, includeInactive = false): Budget[] {
    const sql = `${SELECT_BUDGET}
      WHERE b.user_id = ?${includeInactive ? "" : " AND b.is_active = 1"}
      ORDER BY b.is_active DESC, b.name COLLATE NOCASE ASC, b.created_at ASC`;

    return this.db
      .prepare<[string], BudgetRow>(sql)
      .all(userId)
      .map(mapBudget);
  }

  findById(userId: string, budgetId: string): Budget | undefined {
    const row = this.db
      .prepare<[string, string], BudgetRow>(
        `${SELECT_BUDGET} WHERE b.id = ? AND b.user_id = ?`,
      )
      .get(budgetId, userId);
    return row ? mapBudget(row) : undefined;
  }

  create(record: CreateBudgetRecord): void {
    this.db
      .prepare<
        [
          string,
          string,
          string | null,
          string,
          number,
          string,
          BudgetPeriodType,
          string,
          string | null,
          number,
          number,
          string,
          string,
        ]
      >(
        `INSERT INTO budgets
           (id, user_id, category_id, name, limit_minor, currency_code, period_type,
            start_date, end_date, alert_threshold, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.userId,
        record.categoryId,
        record.name,
        record.limitMinor,
        record.currencyCode,
        record.periodType,
        record.startDate,
        record.endDate,
        record.alertThreshold,
        record.isActive ? 1 : 0,
        record.now,
        record.now,
      );
  }

  update(record: UpdateBudgetRecord): void {
    this.db
      .prepare<
        [
          string | null,
          string,
          number,
          string,
          BudgetPeriodType,
          string,
          string | null,
          number,
          number,
          string,
          string,
        ]
      >(
        `UPDATE budgets
         SET category_id = ?, name = ?, limit_minor = ?, currency_code = ?, period_type = ?,
             start_date = ?, end_date = ?, alert_threshold = ?, is_active = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        record.categoryId,
        record.name,
        record.limitMinor,
        record.currencyCode,
        record.periodType,
        record.startDate,
        record.endDate,
        record.alertThreshold,
        record.isActive ? 1 : 0,
        record.now,
        record.id,
      );
  }

  deactivate(userId: string, budgetId: string, now: string): void {
    this.db
      .prepare<[string, string, string]>(
        "UPDATE budgets SET is_active = 0, updated_at = ? WHERE id = ? AND user_id = ?",
      )
      .run(now, budgetId, userId);
  }

  /**
   * Soma as despesas do período. Quando o orçamento aponta para uma categoria,
   * a subárvore inteira entra no cálculo.
   */
  spentMinor(userId: string, budget: Budget, from: string, to: string): number {
    const useCategory = budget.categoryId !== null;
    const params: unknown[] = useCategory
      ? [budget.categoryId, userId, userId, budget.currencyCode, from, to]
      : [userId, budget.currencyCode, from, to];
    const cte = useCategory
      ? `WITH RECURSIVE subtree(id) AS (
           SELECT id FROM categories WHERE id = ? AND user_id = ?
           UNION ALL
           SELECT c.id FROM categories c JOIN subtree s ON c.parent_id = s.id
         )`
      : "";
    const categoryFilter = useCategory ? " AND t.category_id IN (SELECT id FROM subtree)" : "";

    const row = this.db
      .prepare<unknown[], { total: number | null }>(
        `${cte}
         SELECT COALESCE(SUM(t.amount_minor), 0) AS total
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         WHERE a.user_id = ? AND t.deleted_at IS NULL
           AND t.type = 'expense' AND t.currency_code = ?
           AND t.transaction_date >= ? AND t.transaction_date <= ?${categoryFilter}`,
      )
      .get(...params);

    return row?.total ?? 0;
  }
}

function mapBudget(row: BudgetRow): Budget {
  return {
    id: row.id,
    userId: row.user_id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    name: row.name,
    limitMinor: row.limit_minor,
    currencyCode: row.currency_code,
    periodType: row.period_type,
    startDate: row.start_date,
    endDate: row.end_date,
    alertThreshold: row.alert_threshold,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
