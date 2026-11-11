import type { AppDatabase } from "../db/client.ts";
import { generateOpaqueToken } from "../shared/crypto/tokens.ts";
import {
  type ClaimedEvent,
  type EventPayload,
  type EventStatus,
  type EventType,
  type FailureOutcome,
  type OutboxEvent,
  type OutboxStats,
  parseEventPayload,
  type RecoveryResult,
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

export interface ClaimRequest {
  readonly workerId: string;
  /** Instante atual em ISO-8601 UTC. */
  readonly now: string;
  /** Validade da concessão em milissegundos. */
  readonly leaseMs: number;
}

export interface FailRequest {
  readonly error: string;
  readonly now: string;
  /** Quando o evento volta para a fila (retry transitório). */
  readonly nextAvailableAt: string;
  readonly maxAttempts: number;
  /** Falha permanente vai direto para dead letter, sem retry. */
  readonly permanent?: boolean;
}

export interface RecoveryRequest {
  readonly now: string;
  readonly maxAttempts: number;
  /** Lease considerado para linhas legadas sem `lease_expires_at`. */
  readonly leaseMs: number;
}

export type ReplayOutcome =
  | "replayed"
  | "not_found"
  | "processing"
  | "not_replayable";

/** Estados terminais que podem ser reenfileirados manualmente. */
const REPLAYABLE_STATUSES: readonly EventStatus[] = ["dead_letter", "failed"];

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
  lease_token: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
  created_at: string;
  processed_at: string | null;
  replay_count: number;
  replayed_at: string | null;
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
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    processedAt: row.processed_at,
    replayCount: row.replay_count,
    replayedAt: row.replayed_at,
  };
}

function toClaimed(row: OutboxRow): ClaimedEvent {
  const event = toEvent(row);
  // O claim só devolve linhas recém-adquiridas, então os campos de lease
  // existem; o guarda mantém o tipo honesto se o schema regredir.
  if (
    event.workerId === null ||
    event.leaseToken === null ||
    event.leaseExpiresAt === null
  ) {
    throw new Error("claim sem worker_id/lease_token/lease_expires_at");
  }
  return {
    ...event,
    status: "processing",
    workerId: event.workerId,
    leaseToken: event.leaseToken,
    leaseExpiresAt: event.leaseExpiresAt,
  };
}

/** Instante de expiração do lease a partir de `now` e `leaseMs`. */
function leaseExpiration(now: string, leaseMs: number): string {
  return new Date(new Date(now).getTime() + leaseMs).toISOString();
}

/**
 * Fila transacional de eventos.
 *
 * `insert` é chamado dentro da transação da regra de negócio. O claim usa um
 * único `UPDATE ... RETURNING`, atômico mesmo com vários workers, e grava um
 * `lease_token` novo a cada aquisição. Confirmação, renovação e falha só
 * afetam a linha se `status`, `worker_id` e `lease_token` ainda forem os da
 * concessão corrente — uma instância que perdeu o lease não consegue
 * sobrescrever o evento recuperado por outra.
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

  /**
   * Adquire o próximo evento disponível.
   *
   * A transação é a própria instrução: nenhuma chamada externa acontece com o
   * lock de escrita aberto. `attempts` é incrementado na aquisição, então o
   * total de tentativas inclui a execução corrente.
   */
  claimNext(request: ClaimRequest): ClaimedEvent | null {
    const leaseToken = generateOpaqueToken(32);
    const leaseExpiresAt = leaseExpiration(request.now, request.leaseMs);

    const row = this.db
      .prepare<[string, string, string, string, string], OutboxRow>(
        `UPDATE event_outbox
         SET status = 'processing', locked_at = ?, worker_id = ?,
             lease_token = ?, lease_expires_at = ?, attempts = attempts + 1
         WHERE id = (
           SELECT id FROM event_outbox
           WHERE status = 'pending' AND available_at <= ?
           ORDER BY priority DESC, available_at ASC, created_at ASC
           LIMIT 1
         )
         RETURNING *`,
      )
      .get(request.now, request.workerId, leaseToken, leaseExpiresAt, request.now);

    return row === undefined ? null : toClaimed(row);
  }

  /**
   * Estende a concessão enquanto o processamento continua.
   *
   * Retorna `false` quando o evento já não pertence mais a esta concessão; o
   * chamador deve descartar o resultado em vez de confirmar.
   */
  renewLease(
    eventId: string,
    workerId: string,
    leaseToken: string,
    now: string,
    leaseMs: number,
  ): boolean {
    const changes = this.db
      .prepare<[string, string, string, string]>(
        `UPDATE event_outbox
         SET lease_expires_at = ?
         WHERE id = ? AND status = 'processing' AND worker_id = ? AND lease_token = ?`,
      )
      .run(leaseExpiration(now, leaseMs), eventId, workerId, leaseToken).changes;

    return changes === 1;
  }

  /** Confirma o processamento; stale leases não alteram a linha. */
  complete(
    eventId: string,
    workerId: string,
    leaseToken: string,
    now: string,
  ): boolean {
    const changes = this.db
      .prepare<[string, string, string, string]>(
        `UPDATE event_outbox
         SET status = 'completed', processed_at = ?, locked_at = NULL,
             worker_id = NULL, lease_token = NULL, lease_expires_at = NULL
         WHERE id = ? AND status = 'processing' AND worker_id = ? AND lease_token = ?`,
      )
      .run(now, eventId, workerId, leaseToken).changes;

    return changes === 1;
  }

  /**
   * Libera o evento após falha.
   *
   * Falha permanente ou tentativas esgotadas vão para `dead_letter`; as demais
   * voltam para `pending` com o próximo `available_at` já calculado pelo
   * backoff. Retorna `lost` quando a concessão não é mais deste worker.
   */
  fail(event: ClaimedEvent, request: FailRequest): FailureOutcome {
    const deadLetter = request.permanent === true ||
      event.attempts >= request.maxAttempts;
    const error = request.error.slice(0, 1_000);

    const changes = deadLetter
      ? this.db
        .prepare<[string, string, string, string, string]>(
          `UPDATE event_outbox
           SET status = 'dead_letter', last_error = ?, processed_at = ?,
               locked_at = NULL, worker_id = NULL, lease_token = NULL,
               lease_expires_at = NULL
           WHERE id = ? AND status = 'processing' AND worker_id = ? AND lease_token = ?`,
        )
        .run(error, request.now, event.id, event.workerId, event.leaseToken).changes
      : this.db
        .prepare<[string, string, string, string, string]>(
          `UPDATE event_outbox
           SET status = 'pending', available_at = ?, last_error = ?,
               locked_at = NULL, worker_id = NULL, lease_token = NULL,
               lease_expires_at = NULL
           WHERE id = ? AND status = 'processing' AND worker_id = ? AND lease_token = ?`,
        )
        .run(
          request.nextAvailableAt,
          error,
          event.id,
          event.workerId,
          event.leaseToken,
        ).changes;

    if (changes === 0) return "lost";
    return deadLetter ? "dead_letter" : "retry";
  }

  /**
   * Recupera eventos cujo lease venceu.
   *
   * Linhas legadas (gravadas por uma imagem anterior, sem `lease_token`) usam
   * `locked_at` como referência para permitir rollback sem perder eventos.
   */
  recoverExpired(request: RecoveryRequest): RecoveryResult {
    const legacyCutoff = new Date(
      new Date(request.now).getTime() - request.leaseMs,
    ).toISOString();

    const expiredCondition = `status = 'processing' AND (
      (lease_expires_at IS NOT NULL AND lease_expires_at < ?)
      OR (lease_token IS NULL AND locked_at < ?)
    )`;

    const deadLettered = this.db
      .prepare<[string, number, string, string]>(
        `UPDATE event_outbox
         SET status = 'dead_letter', last_error = 'lease expirado',
             processed_at = ?, locked_at = NULL, worker_id = NULL,
             lease_token = NULL, lease_expires_at = NULL
         WHERE attempts >= ? AND ${expiredCondition}`,
      )
      .run(request.now, request.maxAttempts, request.now, legacyCutoff).changes;

    const retried = this.db
      .prepare<[string, number, string, string]>(
        `UPDATE event_outbox
         SET status = 'pending', available_at = ?, last_error = 'lease expirado',
             locked_at = NULL, worker_id = NULL, lease_token = NULL,
             lease_expires_at = NULL
         WHERE attempts < ? AND ${expiredCondition}`,
      )
      .run(request.now, request.maxAttempts, request.now, legacyCutoff).changes;

    return { retried, deadLettered };
  }

  findById(eventId: string): OutboxEvent | null {
    const row = this.db
      .prepare<[string], OutboxRow>("SELECT * FROM event_outbox WHERE id = ?")
      .get(eventId);
    return row === undefined ? null : toEvent(row);
  }

  listByStatus(statuses: readonly EventStatus[], limit: number): OutboxEvent[] {
    if (statuses.length === 0) return [];
    const placeholders = statuses.map(() => "?").join(", ");
    return this.db
      .prepare<unknown[], OutboxRow>(
        `SELECT * FROM event_outbox
         WHERE status IN (${placeholders})
         ORDER BY created_at ASC, rowid ASC
         LIMIT ?`,
      )
      .all(...statuses, limit)
      .map(toEvent);
  }

  stats(): OutboxStats {
    const rows = this.db
      .prepare<[], { status: EventStatus; count: number }>(
        "SELECT status, COUNT(*) AS count FROM event_outbox GROUP BY status",
      )
      .all();

    const counts: Record<EventStatus, number> = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      dead_letter: 0,
    };
    for (const row of rows) counts[row.status] = row.count;

    return {
      pending: counts.pending,
      processing: counts.processing,
      completed: counts.completed,
      failed: counts.failed,
      deadLetter: counts.dead_letter,
    };
  }

  /** Distribuição por tipo de evento dentro de um status. */
  statsByType(status: EventStatus): Array<{ type: EventType; count: number }> {
    return this.db
      .prepare<[EventStatus], { type: EventType; count: number }>(
        `SELECT type, COUNT(*) AS count FROM event_outbox
         WHERE status = ?
         GROUP BY type
         ORDER BY count DESC, type ASC`,
      )
      .all(status);
  }

  /** Eventos pendentes que já falharam pelo menos uma vez. */
  retryingCount(): number {
    const row = this.db
      .prepare<[], { count: number }>(
        "SELECT COUNT(*) AS count FROM event_outbox WHERE status = 'pending' AND attempts > 0",
      )
      .get();

    return row?.count ?? 0;
  }

  /** Idade, em segundos, do evento pendente mais antigo (desde a criação). */
  oldestPendingAgeSeconds(now: string): number {
    const row = this.db
      .prepare<[], { oldest: string | null }>(
        "SELECT MIN(created_at) AS oldest FROM event_outbox WHERE status = 'pending'",
      )
      .get();

    if (row?.oldest === null || row?.oldest === undefined) return 0;
    const ageMs = new Date(now).getTime() - new Date(row.oldest).getTime();
    return Math.max(0, Math.floor(ageMs / 1_000));
  }

  /**
   * Recoloca um evento terminal na fila para replay manual.
   *
   * `attempts` é zerado e `replay_count`/`replayed_at` registram a intervenção.
   * Um evento `processing` só é reenfileirado com `force`, e mesmo assim
   * recebe um lease novo quando outro worker o adquirir.
   */
  replay(eventId: string, now: string, force = false): ReplayOutcome {
    const existing = this.findById(eventId);
    if (existing === null) return "not_found";

    if (existing.status === "processing" && !force) return "processing";
    if (!REPLAYABLE_STATUSES.includes(existing.status) && !force) {
      return "not_replayable";
    }

    this.db
      .prepare<[string, string, string]>(
        `UPDATE event_outbox
         SET status = 'pending', attempts = 0, available_at = ?,
             processed_at = NULL, locked_at = NULL, worker_id = NULL,
             lease_token = NULL, lease_expires_at = NULL,
             replay_count = replay_count + 1, replayed_at = ?
         WHERE id = ?`,
      )
      .run(now, now, eventId);

    return "replayed";
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
