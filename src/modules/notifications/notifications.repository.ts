import type { AppDatabase } from "../../db/client.ts";

export const NOTIFICATION_CATEGORIES = [
  "finance",
  "habit",
  "security",
  "system",
  "investment",
  "family",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_SEVERITIES = ["low", "medium", "high", "critical"] as const;

export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export interface Notification {
  readonly id: string;
  readonly userId: string;
  readonly title: string;
  readonly message: string;
  readonly category: NotificationCategory;
  readonly severity: NotificationSeverity;
  readonly link: string | null;
  readonly isRead: boolean;
  readonly createdAt: string;
}

export interface CreateNotificationRecord {
  readonly id: string;
  readonly userId: string;
  readonly title: string;
  readonly message: string;
  readonly category: NotificationCategory;
  readonly severity: NotificationSeverity;
  readonly link: string | null;
  readonly now: string;
  /** Chave de deduplicação do efeito (`id do evento: título`). */
  readonly dedupeKey?: string | null;
}

export interface CreateNotificationResult {
  readonly notification: Notification;
  /** `false` quando a restrição única impediu uma notificação duplicada. */
  readonly created: boolean;
}

export interface ListNotificationsOptions {
  readonly isRead?: boolean;
  readonly limit: number;
  readonly offset: number;
}

export interface NotificationPage {
  readonly items: Notification[];
  readonly hasMore: boolean;
}

interface NotificationRow {
  id: string;
  user_id: string;
  title: string;
  message: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  link: string | null;
  is_read: number;
  created_at: string;
}

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    message: row.message,
    category: row.category,
    severity: row.severity,
    link: row.link,
    isRead: row.is_read === 1,
    createdAt: row.created_at,
  };
}

export class NotificationsRepository {
  readonly #db: AppDatabase;

  constructor(db: AppDatabase) {
    this.#db = db;
  }

  create(record: CreateNotificationRecord): Notification {
    this.#db
      .prepare<
        [
          string,
          string,
          string,
          string,
          NotificationCategory,
          NotificationSeverity,
          string | null,
          string,
          string | null,
        ]
      >(
        `INSERT INTO notifications (
           id, user_id, title, message, category, severity, link, is_read,
           created_at, dedupe_key
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        record.id,
        record.userId,
        record.title,
        record.message,
        record.category,
        record.severity,
        record.link,
        record.now,
        record.dedupeKey ?? null,
      );

    return {
      id: record.id,
      userId: record.userId,
      title: record.title,
      message: record.message,
      category: record.category,
      severity: record.severity,
      link: record.link,
      isRead: false,
      createdAt: record.now,
    };
  }

  /**
   * Cria a notificação se a chave de deduplicação ainda não existir.
   *
   * A restrição UNIQUE cobre o replay do mesmo evento; notificações sem chave
   * (conquistas, família) mantêm o comportamento anterior.
   */
  createIfAbsent(record: CreateNotificationRecord): CreateNotificationResult {
    const changes = this.#db
      .prepare<
        [
          string,
          string,
          string,
          string,
          NotificationCategory,
          NotificationSeverity,
          string | null,
          string,
          string | null,
        ]
      >(
        `INSERT INTO notifications (
           id, user_id, title, message, category, severity, link, is_read,
           created_at, dedupe_key
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT DO NOTHING`,
      )
      .run(
        record.id,
        record.userId,
        record.title,
        record.message,
        record.category,
        record.severity,
        record.link,
        record.now,
        record.dedupeKey ?? null,
      ).changes;

    if (changes === 1) {
      return {
        notification: this.createView(record),
        created: true,
      };
    }

    const key = record.dedupeKey ?? null;
    if (key === null) {
      throw new Error("notificação não persistida");
    }

    const row = this.#db
      .prepare<[string, string], NotificationRow>(
        "SELECT * FROM notifications WHERE user_id = ? AND dedupe_key = ?",
      )
      .get(record.userId, key);

    if (row === undefined) {
      throw new Error("notificação duplicada sem registro correspondente");
    }

    return { notification: toNotification(row), created: false };
  }

  private createView(record: CreateNotificationRecord): Notification {
    return {
      id: record.id,
      userId: record.userId,
      title: record.title,
      message: record.message,
      category: record.category,
      severity: record.severity,
      link: record.link,
      isRead: false,
      createdAt: record.now,
    };
  }

  list(userId: string, options: ListNotificationsOptions): NotificationPage {
    const filters = ["user_id = ?"];
    const params: unknown[] = [userId];

    if (options.isRead !== undefined) {
      filters.push("is_read = ?");
      params.push(options.isRead ? 1 : 0);
    }

    // Uma linha extra detecta `hasMore` sem um COUNT separado.
    const rows = this.#db
      .prepare<unknown[], NotificationRow>(
        `SELECT * FROM notifications
         WHERE ${filters.join(" AND ")}
         ORDER BY created_at DESC, rowid DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, options.limit + 1, options.offset);

    const hasMore = rows.length > options.limit;
    return {
      items: rows.slice(0, options.limit).map(toNotification),
      hasMore,
    };
  }

  countUnread(userId: string): number {
    const row = this.#db
      .prepare<[string], { count: number }>(
        "SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0",
      )
      .get(userId);
    return row?.count ?? 0;
  }

  findById(userId: string, id: string): Notification | null {
    const row = this.#db
      .prepare<[string, string], NotificationRow>(
        "SELECT * FROM notifications WHERE id = ? AND user_id = ?",
      )
      .get(id, userId);
    return row === undefined ? null : toNotification(row);
  }

  markRead(userId: string, id: string): Notification | null {
    const result = this.#db
      .prepare<[string, string]>(
        "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?",
      )
      .run(id, userId);
    if (result.changes === 0) return null;
    return this.findById(userId, id);
  }

  markAllRead(userId: string): number {
    const result = this.#db
      .prepare<[string]>(
        "UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0",
      )
      .run(userId);
    return result.changes;
  }

  hasByTitle(userId: string, title: string): boolean {
    const row = this.#db
      .prepare<[string, string], { id: string }>(
        "SELECT id FROM notifications WHERE user_id = ? AND title = ? LIMIT 1",
      )
      .get(userId, title);
    return row !== undefined;
  }
}
