import type { AppDatabase } from "../../db/client.ts";

export const FAMILY_LINK_STATUSES = ["pending", "accepted", "rejected", "revoked"] as const;

export type FamilyLinkStatus = (typeof FAMILY_LINK_STATUSES)[number];

export interface FamilyLink {
  readonly id: string;
  readonly requesterId: string;
  readonly addresseeId: string;
  readonly status: FamilyLinkStatus;
  readonly createdAt: string;
  readonly respondedAt: string | null;
}

export interface FamilyUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

export interface FamilyLinkWithPartner extends FamilyLink {
  readonly partnerId: string;
  readonly partnerName: string;
  readonly partnerEmail: string;
}

export interface FamilyCurrencyTotal {
  readonly currencyCode: string;
  readonly incomeMinor: number;
  readonly expenseMinor: number;
  readonly transferNetMinor: number;
  readonly netMinor: number;
  readonly transactionCount: number;
}

export interface FamilyCounts {
  readonly activeAccounts: number;
  readonly activeHabits: number;
  readonly habitLogs: number;
  readonly activeGoals: number;
  readonly unlockedAchievements: number;
}

export interface CreateFamilyLinkRecord {
  readonly id: string;
  readonly requesterId: string;
  readonly addresseeId: string;
  readonly now: string;
}

interface FamilyLinkRow {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: FamilyLinkStatus;
  created_at: string;
  responded_at: string | null;
}

interface FamilyLinkWithPartnerRow extends FamilyLinkRow {
  partner_id: string;
  partner_name: string;
  partner_email: string;
}

interface FamilyTotalRow {
  currency_code: string;
  income_minor: number;
  expense_minor: number;
  transfer_net_minor: number;
  transaction_count: number;
}

interface FamilyCountsRow {
  active_accounts: number;
  active_habits: number;
  habit_logs: number;
  active_goals: number;
  unlocked_achievements: number;
}

function mapLink(row: FamilyLinkRow): FamilyLink {
  return {
    id: row.id,
    requesterId: row.requester_id,
    addresseeId: row.addressee_id,
    status: row.status,
    createdAt: row.created_at,
    respondedAt: row.responded_at,
  };
}

/** Vínculos familiares e agregados do parceiro, sempre escopados por usuário. */
export class FamilyRepository {
  constructor(private readonly db: AppDatabase) {}

  findById(linkId: string): FamilyLink | undefined {
    const row = this.db
      .prepare<[string], FamilyLinkRow>(
        `SELECT id, requester_id, addressee_id, status, created_at, responded_at
         FROM family_links WHERE id = ?`,
      )
      .get(linkId);
    return row ? mapLink(row) : undefined;
  }

  /** Busca o vínculo entre dois usuários em qualquer direção. */
  findByPair(firstUserId: string, secondUserId: string): FamilyLink | undefined {
    const row = this.db
      .prepare<[string, string, string, string], FamilyLinkRow>(
        `SELECT id, requester_id, addressee_id, status, created_at, responded_at
         FROM family_links
         WHERE (requester_id = ? AND addressee_id = ?)
            OR (requester_id = ? AND addressee_id = ?)
         LIMIT 1`,
      )
      .get(firstUserId, secondUserId, secondUserId, firstUserId);
    return row ? mapLink(row) : undefined;
  }

  /** Um usuário só pode ter um vínculo pendente ou ativo por vez. */
  hasPendingOrActive(userId: string): boolean {
    const row = this.db
      .prepare<[string, string], { found: number }>(
        `SELECT 1 AS found FROM family_links
         WHERE status IN ('pending', 'accepted')
           AND (requester_id = ? OR addressee_id = ?)
         LIMIT 1`,
      )
      .get(userId, userId);
    return row !== undefined;
  }

  findUserByEmail(email: string): FamilyUser | undefined {
    const row = this.db
      .prepare<[string], { id: string; name: string; email: string }>(
        `SELECT p.id, p.name, c.email
         FROM user_credentials c
         JOIN user_profiles p ON p.id = c.user_id
         WHERE c.email = ?`,
      )
      .get(email);
    return row;
  }

  findWithPartner(userId: string, linkId: string): FamilyLinkWithPartner | undefined {
    const row = this.db
      .prepare<[string, string, string, string], FamilyLinkWithPartnerRow>(
        `SELECT fl.id, fl.requester_id, fl.addressee_id, fl.status,
                fl.created_at, fl.responded_at,
                p.id AS partner_id, p.name AS partner_name, c.email AS partner_email
         FROM family_links fl
         JOIN user_profiles p
           ON p.id = CASE
             WHEN fl.requester_id = ? THEN fl.addressee_id
             ELSE fl.requester_id
           END
         JOIN user_credentials c ON c.user_id = p.id
         WHERE fl.id = ? AND (fl.requester_id = ? OR fl.addressee_id = ?)`,
      )
      .get(userId, linkId, userId, userId);
    return row
      ? {
        ...mapLink(row),
        partnerId: row.partner_id,
        partnerName: row.partner_name,
        partnerEmail: row.partner_email,
      }
      : undefined;
  }

  listForUser(userId: string): FamilyLinkWithPartner[] {
    return this.db
      .prepare<[string, string, string], FamilyLinkWithPartnerRow>(
        `SELECT fl.id, fl.requester_id, fl.addressee_id, fl.status,
                fl.created_at, fl.responded_at,
                p.id AS partner_id, p.name AS partner_name, c.email AS partner_email
         FROM family_links fl
         JOIN user_profiles p
           ON p.id = CASE
             WHEN fl.requester_id = ? THEN fl.addressee_id
             ELSE fl.requester_id
           END
         JOIN user_credentials c ON c.user_id = p.id
         WHERE fl.requester_id = ? OR fl.addressee_id = ?
         ORDER BY fl.created_at DESC`,
      )
      .all(userId, userId, userId)
      .map((row) => ({
        ...mapLink(row),
        partnerId: row.partner_id,
        partnerName: row.partner_name,
        partnerEmail: row.partner_email,
      }));
  }

  create(record: CreateFamilyLinkRecord): FamilyLink {
    this.db
      .prepare<[string, string, string, string]>(
        `INSERT INTO family_links (
           id, requester_id, addressee_id, status, created_at, responded_at
         ) VALUES (?, ?, ?, 'pending', ?, NULL)`,
      )
      .run(record.id, record.requesterId, record.addresseeId, record.now);

    return {
      id: record.id,
      requesterId: record.requesterId,
      addresseeId: record.addresseeId,
      status: "pending",
      createdAt: record.now,
      respondedAt: null,
    };
  }

  /** Reaproveita um vínculo recusado/revogado em vez de acumular linhas. */
  reopen(
    linkId: string,
    requesterId: string,
    addresseeId: string,
    now: string,
  ): void {
    this.db
      .prepare<[string, string, string, string]>(
        `UPDATE family_links
         SET requester_id = ?, addressee_id = ?, status = 'pending',
             created_at = ?, responded_at = NULL
         WHERE id = ?`,
      )
      .run(requesterId, addresseeId, now, linkId);
  }

  updateStatus(linkId: string, status: FamilyLinkStatus, now: string): void {
    this.db
      .prepare<[FamilyLinkStatus, string, string]>(
        `UPDATE family_links SET status = ?, responded_at = ? WHERE id = ?`,
      )
      .run(status, now, linkId);
  }

  financeTotals(partnerId: string, from: string, to: string): FamilyCurrencyTotal[] {
    return this.db
      .prepare<[string, string, string], FamilyTotalRow>(
        `SELECT t.currency_code,
                SUM(CASE WHEN t.type = 'income' THEN t.amount_minor ELSE 0 END)
                  AS income_minor,
                SUM(CASE WHEN t.type = 'expense' THEN t.amount_minor ELSE 0 END)
                  AS expense_minor,
                SUM(CASE WHEN t.type = 'transfer' THEN t.amount_minor ELSE 0 END)
                  AS transfer_net_minor,
                COUNT(*) AS transaction_count
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         WHERE a.user_id = ?
           AND t.deleted_at IS NULL
           AND t.transaction_date BETWEEN ? AND ?
         GROUP BY t.currency_code
         ORDER BY t.currency_code`,
      )
      .all(partnerId, from, to)
      .map((row) => ({
        currencyCode: row.currency_code,
        incomeMinor: row.income_minor,
        expenseMinor: row.expense_minor,
        transferNetMinor: row.transfer_net_minor,
        netMinor: row.income_minor - row.expense_minor + row.transfer_net_minor,
        transactionCount: row.transaction_count,
      }));
  }

  counts(partnerId: string, from: string, to: string): FamilyCounts {
    const row = this.db
      .prepare<[string, string, string, string, string, string, string], FamilyCountsRow>(
        `SELECT
           (SELECT COUNT(*) FROM accounts WHERE user_id = ? AND is_active = 1)
             AS active_accounts,
           (SELECT COUNT(*) FROM habits WHERE user_id = ? AND is_active = 1)
             AS active_habits,
           (SELECT COUNT(*) FROM habit_logs l
              JOIN habits h ON h.id = l.habit_id
             WHERE h.user_id = ? AND l.deleted_at IS NULL
               AND l.log_date BETWEEN ? AND ?)
             AS habit_logs,
           (SELECT COUNT(*) FROM goals WHERE user_id = ? AND status = 'active')
             AS active_goals,
           (SELECT COUNT(*) FROM user_achievements
             WHERE user_id = ? AND is_unlocked = 1)
             AS unlocked_achievements`,
      )
      .get(
        partnerId,
        partnerId,
        partnerId,
        from,
        to,
        partnerId,
        partnerId,
      );

    return {
      activeAccounts: row?.active_accounts ?? 0,
      activeHabits: row?.active_habits ?? 0,
      habitLogs: row?.habit_logs ?? 0,
      activeGoals: row?.active_goals ?? 0,
      unlockedAchievements: row?.unlocked_achievements ?? 0,
    };
  }
}
