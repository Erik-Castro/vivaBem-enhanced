import type { AppDatabase } from "../../db/client.ts";

export const INSIGHT_CATEGORIES = [
  "finance",
  "habit",
  "security",
  "investment",
  "recommendation",
  "family",
  "correlation",
] as const;

export type InsightCategory = (typeof INSIGHT_CATEGORIES)[number];

export const INSIGHT_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type InsightSeverity = (typeof INSIGHT_SEVERITIES)[number];

export const FEEDBACK_RATINGS = ["helpful", "not_helpful"] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];

export interface AiInsight {
  readonly id: string;
  readonly userId: string;
  readonly category: InsightCategory;
  readonly severity: InsightSeverity;
  readonly title: string;
  readonly message: string;
  readonly sourceEvent: string | null;
  readonly confidence: number;
  readonly isRead: boolean;
  readonly createdAt: string;
}

export interface CreateInsightRecord {
  readonly id: string;
  readonly userId: string;
  readonly category: InsightCategory;
  readonly severity: InsightSeverity;
  readonly title: string;
  readonly message: string;
  readonly sourceEvent: string | null;
  readonly confidence: number;
  readonly now: string;
}

export interface ListInsightsOptions {
  readonly category?: InsightCategory;
  readonly isRead?: boolean;
  readonly limit: number;
  readonly offset: number;
}

export interface InsightPage {
  readonly items: AiInsight[];
  readonly hasMore: boolean;
}

export interface InsightFeedback {
  readonly id: string;
  readonly insightId: string;
  readonly userId: string;
  readonly rating: FeedbackRating;
  readonly comment: string | null;
  readonly createdAt: string;
}

export interface UpsertFeedbackRecord {
  readonly id: string;
  readonly insightId: string;
  readonly userId: string;
  readonly rating: FeedbackRating;
  readonly comment: string | null;
  readonly now: string;
}

interface InsightRow {
  id: string;
  user_id: string;
  category: InsightCategory;
  severity: InsightSeverity;
  title: string;
  message: string;
  source_event: string | null;
  confidence: number;
  is_read: number;
  created_at: string;
}

interface FeedbackRow {
  id: string;
  insight_id: string;
  user_id: string;
  rating: FeedbackRating;
  comment: string | null;
  created_at: string;
}

function toInsight(row: InsightRow): AiInsight {
  return {
    id: row.id,
    userId: row.user_id,
    category: row.category,
    severity: row.severity,
    title: row.title,
    message: row.message,
    sourceEvent: row.source_event,
    confidence: row.confidence,
    isRead: row.is_read === 1,
    createdAt: row.created_at,
  };
}

function toFeedback(row: FeedbackRow): InsightFeedback {
  return {
    id: row.id,
    insightId: row.insight_id,
    userId: row.user_id,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
  };
}

/**
 * Persistência dos insights gerados pela IA.
 *
 * Toda consulta é escopada por `user_id`; nenhum método aceita id sem o dono.
 */
export class InsightsRepository {
  readonly #db: AppDatabase;

  constructor(db: AppDatabase) {
    this.#db = db;
  }

  create(record: CreateInsightRecord): AiInsight {
    this.#db
      .prepare<
        [
          string,
          string,
          InsightCategory,
          InsightSeverity,
          string,
          string,
          string | null,
          number,
          string,
        ]
      >(
        `INSERT INTO ai_insights (
           id, user_id, category, severity, title, message, source_event,
           confidence, is_read, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(
        record.id,
        record.userId,
        record.category,
        record.severity,
        record.title,
        record.message,
        record.sourceEvent,
        record.confidence,
        record.now,
      );

    return {
      id: record.id,
      userId: record.userId,
      category: record.category,
      severity: record.severity,
      title: record.title,
      message: record.message,
      sourceEvent: record.sourceEvent,
      confidence: record.confidence,
      isRead: false,
      createdAt: record.now,
    };
  }

  list(userId: string, options: ListInsightsOptions): InsightPage {
    const filters = ["user_id = ?"];
    const params: unknown[] = [userId];

    if (options.category !== undefined) {
      filters.push("category = ?");
      params.push(options.category);
    }
    if (options.isRead !== undefined) {
      filters.push("is_read = ?");
      params.push(options.isRead ? 1 : 0);
    }

    const rows = this.#db
      .prepare<unknown[], InsightRow>(
        `SELECT * FROM ai_insights
         WHERE ${filters.join(" AND ")}
         ORDER BY created_at DESC, rowid DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, options.limit + 1, options.offset);

    return {
      items: rows.slice(0, options.limit).map(toInsight),
      hasMore: rows.length > options.limit,
    };
  }

  findById(userId: string, id: string): AiInsight | null {
    const row = this.#db
      .prepare<[string, string], InsightRow>(
        "SELECT * FROM ai_insights WHERE id = ? AND user_id = ?",
      )
      .get(id, userId);
    return row === undefined ? null : toInsight(row);
  }

  findByIds(userId: string, ids: readonly string[]): AiInsight[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(", ");
    return this.#db
      .prepare<unknown[], InsightRow>(
        `SELECT * FROM ai_insights
         WHERE user_id = ? AND id IN (${placeholders})`,
      )
      .all(userId, ...ids)
      .map(toInsight);
  }

  markRead(userId: string, id: string): AiInsight | null {
    const result = this.#db
      .prepare<[string, string]>(
        "UPDATE ai_insights SET is_read = 1 WHERE id = ? AND user_id = ?",
      )
      .run(id, userId);
    if (result.changes === 0) return null;
    return this.findById(userId, id);
  }

  markAllRead(userId: string): number {
    return this.#db
      .prepare<[string]>(
        "UPDATE ai_insights SET is_read = 1 WHERE user_id = ? AND is_read = 0",
      )
      .run(userId).changes;
  }

  countUnread(userId: string): number {
    const row = this.#db
      .prepare<[string], { count: number }>(
        "SELECT COUNT(*) AS count FROM ai_insights WHERE user_id = ? AND is_read = 0",
      )
      .get(userId);
    return row?.count ?? 0;
  }

  searchByText(userId: string, query: string, limit: number): AiInsight[] {
    const term = `%${query.replaceAll("%", "").replaceAll("_", "")}%`;
    return this.#db
      .prepare<[string, string, string, number], InsightRow>(
        `SELECT * FROM ai_insights
         WHERE user_id = ? AND (title LIKE ? OR message LIKE ?)
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(userId, term, term, limit)
      .map(toInsight);
  }

  upsertFeedback(record: UpsertFeedbackRecord): InsightFeedback {
    this.#db
      .prepare<
        [string, string, string, FeedbackRating, string | null, string]
      >(
        `INSERT INTO ai_feedback (id, insight_id, user_id, rating, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (insight_id, user_id) DO UPDATE SET
           rating = excluded.rating,
           comment = excluded.comment,
           created_at = excluded.created_at`,
      )
      .run(
        record.id,
        record.insightId,
        record.userId,
        record.rating,
        record.comment,
        record.now,
      );

    const row = this.#db
      .prepare<[string, string], FeedbackRow>(
        "SELECT * FROM ai_feedback WHERE insight_id = ? AND user_id = ?",
      )
      .get(record.insightId, record.userId);

    if (!row) {
      throw new Error("feedback não persistido");
    }
    return toFeedback(row);
  }
}
