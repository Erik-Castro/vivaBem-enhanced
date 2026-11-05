import type { AppDatabase } from "../db/client.ts";
import {
  type EventPayload,
  type EventStatus,
  type EventType,
  type OutboxEvent,
  type OutboxStats,
  parseEventPayload,
} from "./events.types.ts";

export interface InsertOutboxRecord {
  readonly id: string;
  readonly type: EventType;
  readonly aggregateType: string;
  readonly aggregateId: string | null;
  readonly userId: string;
  readonly payload: EventPayload;
  readonly priority: number;
  readonly availableAt: string;
  readonly now: string;
}

interface OutboxRow {
  id: string;
  type: EventType;
  aggregate_type: string;
  aggregate_id: string | null;
  user_id: string;
  payload: string;
  status: EventStatus;
  priority: number;
  attempts: number;
  available_at: string;
  locked_at: string | null;
  worker_id: string | null;
  last_error: string | null;
  created_at: string;
  processed_at: string | null;
}

function toEvent(row: OutboxRow): OutboxEvent {
  return {
    id: row.id,
    type: row.type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    userId: row.user_id,
    payload: parseEventPayload(row.payload),
    status: row.status,
    priority: row.priority,
    attempts: row.attempts,
    availableAt: row.available_at,
    lockedAt: row.locked_at,
    workerId: row.worker_id,
    lastError: row.last_error,
    createdAt: row.created_at,
    processedAt: row.processed_at,
  };
}

/**
 * Fila transacional de eventos.
 *
 * `insert` é chamado dentro da transação da regra de negócio; o claim usa um
 * único `UPDATE ... RETURNING`, atômico mesmo com mais de um worker.
 */
export class OutboxRepository {
  constructor(private readonly db: AppDatabase) {}

  insert(record: InsertOutboxRecord): void {
    this.db
      .prepare<
        [
          string,
          EventType,
          string,
          string | null,
          string,
          string,
          number,
          string,
          string,
        ]
      >(
        `INSERT INTO event_outbox (
           id, type, aggregate_type, aggregate_id, user_id, payload, status,
           priority, attempts, available_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?)`,
      )
      .run(
        record.id,
        record.type,
        record.aggregateType,
        record.aggregateId,
        record.userId,
        JSON.stringify(record.payload),
        record.priority,
        record.availableAt,
        record.now,
      );
  }

  claimNext(workerId: string, now: string): OutboxEvent | null {
    const row = this.db
      .prepare<[string, string, string], OutboxRow>(
        `UPDATE event_outbox
         SET status = 'processing', locked_at = ?, worker_id = ?, attempts = attempts + 1
         WHERE id = (
           SELECT id FROM event_outbox
           WHERE status = 'pending' AND available_at <= ?
           ORDER BY priority DESC, available_at ASC, created_at ASC
           LIMIT 1
         )
         RETURNING *`,
      )
      .get(now, workerId, now);

    return row === undefined ? null : toEvent(row);
  }

  complete(eventId: string, now: string): void {
    this.db
      .prepare<[string, string]>(
        `UPDATE event_outbox
         SET status = 'completed', processed_at = ?, locked_at = NULL, worker_id = NULL
         WHERE id = ?`,
      )
      .run(now, eventId);
  }

  /**
   * Registra a falha e decide entre retry com backoff e dead-letter.
   * `attempts` já foi incrementado no claim, então o limite é o total de
   * tentativas permitidas. Retorna `true` quando o evento voltou para a fila.
   */
  fail(
    event: OutboxEvent,
    error: string,
    now: string,
    nextAvailableAt: string,
    maxAttempts: number,
  ): boolean {
    const willRetry = event.attempts < maxAttempts;

    if (willRetry) {
      this.db
        .prepare<[string, string, string]>(
          `UPDATE event_outbox
           SET status = 'pending', available_at = ?, last_error = ?,
               locked_at = NULL, worker_id = NULL
           WHERE id = ?`,
        )
        .run(nextAvailableAt, error.slice(0, 1_000), event.id);
    } else {
      this.db
        .prepare<[string, string, string]>(
          `UPDATE event_outbox
           SET status = 'failed', last_error = ?, processed_at = ?,
               locked_at = NULL, worker_id = NULL
           WHERE id = ?`,
        )
        .run(error.slice(0, 1_000), now, event.id);
    }

    return willRetry;
  }

  /**
   * Devolve leases vencidos para a fila. Eventos que já esgotaram as tentativas
   * vão direto para dead-letter para não ficarem em loop.
   */
  recoverStuck(cutoff: string, now: string, maxAttempts: number): number {
    const failed = this.db
      .prepare<[string, string, number]>(
        `UPDATE event_outbox
         SET status = 'failed', last_error = 'lease expirado', processed_at = ?,
             locked_at = NULL, worker_id = NULL
         WHERE status = 'processing' AND locked_at < ? AND attempts >= ?`,
      )
      .run(now, cutoff, maxAttempts).changes;

    const retried = this.db
      .prepare<[string, string, number]>(
        `UPDATE event_outbox
         SET status = 'pending', available_at = ?, last_error = 'lease expirado',
             locked_at = NULL, worker_id = NULL
         WHERE status = 'processing' AND locked_at < ? AND attempts < ?`,
      )
      .run(now, cutoff, maxAttempts).changes;

    return failed + retried;
  }

  findById(eventId: string): OutboxEvent | null {
    const row = this.db
      .prepare<[string], OutboxRow>("SELECT * FROM event_outbox WHERE id = ?")
      .get(eventId);
    return row === undefined ? null : toEvent(row);
  }

  stats(): OutboxStats {
    const rows = this.db
      .prepare<[], { status: EventStatus; count: number }>(
        "SELECT status, COUNT(*) AS count FROM event_outbox GROUP BY status",
      )
      .all();

    const stats = { pending: 0, processing: 0, completed: 0, failed: 0 };
    for (const row of rows) {
      stats[row.status] = row.count;
    }
    return stats;
  }

  hasActiveOfType(userId: string, type: EventType): boolean {
    const row = this.db
      .prepare<[string, EventType], { id: string }>(
        `SELECT id FROM event_outbox
         WHERE user_id = ? AND type = ? AND status IN ('pending', 'processing')
         LIMIT 1`,
      )
      .get(userId, type);
    return row !== undefined;
  }
}
