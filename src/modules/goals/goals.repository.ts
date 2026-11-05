import type { AppDatabase } from "../../db/client.ts";

export const GOAL_STATUSES = ["active", "paused", "completed", "cancelled"] as const;

export type GoalStatus = (typeof GOAL_STATUSES)[number];

export interface Goal {
  readonly id: string;
  readonly userId: string;
  readonly targetAccountId: string | null;
  readonly targetAccountName: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly targetAmountMinor: number;
  readonly currencyCode: string;
  readonly targetDate: string | null;
  readonly status: GoalStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface GoalRow {
  id: string;
  user_id: string;
  target_account_id: string | null;
  name: string;
  description: string | null;
  target_amount_minor: number;
  currency_code: string;
  target_date: string | null;
  status: GoalStatus;
  created_at: string;
  updated_at: string;
  target_account_name: string | null;
}

export interface GoalContribution {
  readonly id: string;
  readonly goalId: string;
  readonly accountId: string | null;
  readonly accountName: string | null;
  readonly transactionId: string | null;
  readonly amountMinor: number;
  readonly contributionDate: string;
  readonly note: string | null;
  readonly createdAt: string;
}

interface ContributionRow {
  id: string;
  goal_id: string;
  account_id: string | null;
  transaction_id: string | null;
  amount_minor: number;
  contribution_date: string;
  note: string | null;
  created_at: string;
  account_name: string | null;
}

export interface CreateGoalRecord {
  readonly id: string;
  readonly userId: string;
  readonly targetAccountId: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly targetAmountMinor: number;
  readonly currencyCode: string;
  readonly targetDate: string | null;
  readonly status: GoalStatus;
  readonly now: string;
}

export interface UpdateGoalRecord {
  readonly id: string;
  readonly targetAccountId: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly targetAmountMinor: number;
  readonly currencyCode: string;
  readonly targetDate: string | null;
  readonly status: GoalStatus;
  readonly now: string;
}

export interface CreateContributionRecord {
  readonly id: string;
  readonly goalId: string;
  readonly accountId: string | null;
  readonly transactionId: string | null;
  readonly amountMinor: number;
  readonly contributionDate: string;
  readonly note: string | null;
  readonly now: string;
}

const SELECT_GOAL = `
  SELECT g.*, a.name AS target_account_name
  FROM goals g
  LEFT JOIN accounts a ON a.id = g.target_account_id
`;

const SELECT_CONTRIBUTION = `
  SELECT c.*, a.name AS account_name
  FROM goal_contributions c
  LEFT JOIN accounts a ON a.id = c.account_id
`;

/** Acesso às metas e contribuições, sempre escopado pelo usuário. */
export class GoalsRepository {
  constructor(private readonly db: AppDatabase) {}

  list(userId: string, filters: { readonly status?: GoalStatus } = {}): Goal[] {
    const params: unknown[] = [userId];
    let sql = `${SELECT_GOAL} WHERE g.user_id = ?`;

    if (filters.status !== undefined) {
      sql += " AND g.status = ?";
      params.push(filters.status);
    }

    sql += ` ORDER BY CASE g.status
        WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
      g.target_date IS NULL, g.target_date ASC, g.name COLLATE NOCASE ASC`;

    return this.db
      .prepare<unknown[], GoalRow>(sql)
      .all(...params)
      .map(mapGoal);
  }

  findById(userId: string, goalId: string): Goal | undefined {
    const row = this.db
      .prepare<[string, string], GoalRow>(`${SELECT_GOAL} WHERE g.id = ? AND g.user_id = ?`)
      .get(goalId, userId);
    return row ? mapGoal(row) : undefined;
  }

  create(record: CreateGoalRecord): void {
    this.db
      .prepare<
        [
          string,
          string,
          string | null,
          string,
          string | null,
          number,
          string,
          string | null,
          GoalStatus,
          string,
          string,
        ]
      >(
        `INSERT INTO goals
           (id, user_id, target_account_id, name, description, target_amount_minor,
            currency_code, target_date, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.userId,
        record.targetAccountId,
        record.name,
        record.description,
        record.targetAmountMinor,
        record.currencyCode,
        record.targetDate,
        record.status,
        record.now,
        record.now,
      );
  }

  update(record: UpdateGoalRecord): void {
    this.db
      .prepare<
        [
          string | null,
          string,
          string | null,
          number,
          string,
          string | null,
          GoalStatus,
          string,
          string,
        ]
      >(
        `UPDATE goals
         SET target_account_id = ?, name = ?, description = ?, target_amount_minor = ?,
             currency_code = ?, target_date = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        record.targetAccountId,
        record.name,
        record.description,
        record.targetAmountMinor,
        record.currencyCode,
        record.targetDate,
        record.status,
        record.now,
        record.id,
      );
  }

  updateStatus(goalId: string, status: GoalStatus, now: string): void {
    this.db
      .prepare<[GoalStatus, string, string]>(
        "UPDATE goals SET status = ?, updated_at = ? WHERE id = ?",
      )
      .run(status, now, goalId);
  }

  sumContributions(goalId: string): number {
    const row = this.db
      .prepare<[string], { total: number | null }>(
        `SELECT COALESCE(SUM(amount_minor), 0) AS total
         FROM goal_contributions WHERE goal_id = ? AND deleted_at IS NULL`,
      )
      .get(goalId);
    return row?.total ?? 0;
  }

  countContributions(goalId: string): number {
    const row = this.db
      .prepare<[string], { count: number }>(
        `SELECT COUNT(*) AS count FROM goal_contributions
         WHERE goal_id = ? AND deleted_at IS NULL`,
      )
      .get(goalId);
    return row?.count ?? 0;
  }

  hasContributions(goalId: string): boolean {
    const row = this.db
      .prepare<[string], { found: number }>(
        `SELECT EXISTS(
           SELECT 1 FROM goal_contributions WHERE goal_id = ? AND deleted_at IS NULL
         ) AS found`,
      )
      .get(goalId);
    return row?.found === 1;
  }

  listContributions(goalId: string): GoalContribution[] {
    return this.db
      .prepare<[string], ContributionRow>(
        `${SELECT_CONTRIBUTION}
         WHERE c.goal_id = ? AND c.deleted_at IS NULL
         ORDER BY c.contribution_date DESC, c.created_at DESC, c.id DESC`,
      )
      .all(goalId)
      .map(mapContribution);
  }

  findContribution(goalId: string, contributionId: string): GoalContribution | undefined {
    const row = this.db
      .prepare<[string, string], ContributionRow>(
        `${SELECT_CONTRIBUTION}
         WHERE c.id = ? AND c.goal_id = ? AND c.deleted_at IS NULL`,
      )
      .get(contributionId, goalId);
    return row ? mapContribution(row) : undefined;
  }

  insertContribution(record: CreateContributionRecord): void {
    this.db
      .prepare<
        [string, string, string | null, string | null, number, string, string | null, string]
      >(
        `INSERT INTO goal_contributions
           (id, goal_id, account_id, transaction_id, amount_minor, contribution_date, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.goalId,
        record.accountId,
        record.transactionId,
        record.amountMinor,
        record.contributionDate,
        record.note,
        record.now,
      );
  }

  softDeleteContribution(contributionId: string, now: string): void {
    this.db
      .prepare<[string, string]>(
        `UPDATE goal_contributions SET deleted_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(now, contributionId);
  }

  lastContributionDate(goalId: string): string | null {
    const row = this.db
      .prepare<[string], { last_date: string | null }>(
        `SELECT MAX(contribution_date) AS last_date FROM goal_contributions
         WHERE goal_id = ? AND deleted_at IS NULL`,
      )
      .get(goalId);
    return row?.last_date ?? null;
  }
}

function mapGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    userId: row.user_id,
    targetAccountId: row.target_account_id,
    targetAccountName: row.target_account_name,
    name: row.name,
    description: row.description,
    targetAmountMinor: row.target_amount_minor,
    currencyCode: row.currency_code,
    targetDate: row.target_date,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapContribution(row: ContributionRow): GoalContribution {
  return {
    id: row.id,
    goalId: row.goal_id,
    accountId: row.account_id,
    accountName: row.account_name,
    transactionId: row.transaction_id,
    amountMinor: row.amount_minor,
    contributionDate: row.contribution_date,
    note: row.note,
    createdAt: row.created_at,
  };
}
