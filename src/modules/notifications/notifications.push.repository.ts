import type { AppDatabase } from "../../db/client.ts";
import { generateOpaqueToken } from "../../shared/crypto/tokens.ts";
import type { NotificationCategory, NotificationSeverity } from "./notifications.repository.ts";
import type {
  ClaimedPushNotification,
  PushSubscriptionInput,
  PushSubscriptionRecord,
} from "./notifications.push.types.ts";

interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

interface PendingPushRow {
  id: string;
  user_id: string;
  title: string;
  message: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  link: string | null;
  created_at: string;
  push_attempts: number;
  push_claim_token: string;
}

export interface UpsertPushSubscriptionRecord extends PushSubscriptionInput {
  readonly id: string;
  readonly userId: string;
  readonly now: string;
}

export interface ClaimPushRequest {
  readonly now: string;
  readonly leaseMs: number;
  readonly limit: number;
}

function toSubscription(row: PushSubscriptionRow): PushSubscriptionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

/**
 * Persistência das assinaturas push e da fila de entrega das notificações.
 *
 * A entrega não usa um evento novo na outbox: a própria linha de `notifications`
 * carrega o estado (`push_state`) e é consumida pelo worker com claim/lease.
 * Assim nenhum dos pontos que criam notificação precisa saber que push existe.
 */
export class NotificationsPushRepository {
  readonly #db: AppDatabase;

  constructor(db: AppDatabase) {
    this.#db = db;
  }

  /**
   * Registra ou atualiza um dispositivo.
   *
   * O índice único é parcial (`endpoint` entre linhas vivas): um navegador que
   * troca de conta reatribui a mesma assinatura em vez de duplicá-la.
   */
  upsert(record: UpsertPushSubscriptionRecord): PushSubscriptionRecord {
    const row = this.#db
      .prepare<
        [string, string, string, string, string, string | null, string, string],
        PushSubscriptionRow
      >(
        `INSERT INTO push_subscriptions (
           id, user_id, endpoint, p256dh, auth, user_agent, created_at, last_seen_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (endpoint) WHERE revoked_at IS NULL
         DO UPDATE SET
           user_id = excluded.user_id,
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           user_agent = excluded.user_agent,
           last_seen_at = excluded.last_seen_at
         RETURNING *`,
      )
      .get(
        record.id,
        record.userId,
        record.endpoint,
        record.p256dh,
        record.auth,
        record.userAgent,
        record.now,
        record.now,
      );

    if (row === undefined) {
      throw new Error("assinatura push não persistida");
    }

    return toSubscription(row);
  }

  listActiveByUser(userId: string): PushSubscriptionRecord[] {
    return this.#db
      .prepare<[string], PushSubscriptionRow>(
        `SELECT * FROM push_subscriptions
         WHERE user_id = ? AND revoked_at IS NULL
         ORDER BY last_seen_at DESC, rowid DESC`,
      )
      .all(userId)
      .map(toSubscription);
  }

  countActiveByUser(userId: string): number {
    const row = this.#db
      .prepare<[string], { count: number }>(
        `SELECT COUNT(*) AS count FROM push_subscriptions
         WHERE user_id = ? AND revoked_at IS NULL`,
      )
      .get(userId);
    return row?.count ?? 0;
  }

  /** Revoga pelo endpoint pertencente ao usuário; `false` quando não existe. */
  revokeByEndpoint(userId: string, endpoint: string, now: string): boolean {
    const changes = this.#db
      .prepare<[string, string, string]>(
        `UPDATE push_subscriptions
         SET revoked_at = ?
         WHERE endpoint = ? AND user_id = ? AND revoked_at IS NULL`,
      )
      .run(now, endpoint, userId).changes;
    return changes > 0;
  }

  /** Revoga uma assinatura específica (endpoint recusado pelo serviço de push). */
  revokeById(id: string, now: string): boolean {
    const changes = this.#db
      .prepare<[string, string]>(
        "UPDATE push_subscriptions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
      )
      .run(now, id).changes;
    return changes > 0;
  }

  findActiveByEndpoint(endpoint: string): PushSubscriptionRecord | null {
    const row = this.#db
      .prepare<[string], PushSubscriptionRow>(
        `SELECT * FROM push_subscriptions
         WHERE endpoint = ? AND revoked_at IS NULL`,
      )
      .get(endpoint);
    return row === undefined ? null : toSubscription(row);
  }

  /**
   * Adquire um lote de notificações pendentes de push.
   *
   * Um único `UPDATE ... RETURNING` é atômico: com vários workers, cada linha é
   * entregue a exatamente um deles enquanto o lease estiver válido. O token da
   * concessão é compartilhado pelo lote — só este worker pode confirmá-lo.
   */
  claimPending(request: ClaimPushRequest): ClaimedPushNotification[] {
    const token = generateOpaqueToken(24);
    const expiresAt = new Date(
      new Date(request.now).getTime() + request.leaseMs,
    ).toISOString();

    return this.#db
      .prepare<[string, string, string, number], PendingPushRow>(
        `UPDATE notifications
         SET push_claim_token = ?, push_claim_expires_at = ?,
             push_attempts = push_attempts + 1
         WHERE id IN (
           SELECT id FROM notifications
           WHERE push_state = 'pending'
             AND (push_claim_expires_at IS NULL OR push_claim_expires_at <= ?)
           ORDER BY created_at ASC, rowid ASC
           LIMIT ?
         )
         RETURNING id, user_id, title, message, category, severity, link,
                   created_at, push_attempts, push_claim_token`,
      )
      .all(token, expiresAt, request.now, request.limit)
      .map((row) => ({
        id: row.id,
        userId: row.user_id,
        title: row.title,
        message: row.message,
        category: row.category,
        severity: row.severity,
        link: row.link,
        createdAt: row.created_at,
        attempts: row.push_attempts,
        claimToken: row.push_claim_token,
      }));
  }

  /** Confirma a entrega; claims expirados/roubados não alteram a linha. */
  markSent(id: string, claimToken: string, now: string): boolean {
    const changes = this.#db
      .prepare<[string, string, string]>(
        `UPDATE notifications
         SET push_state = 'sent', push_sent_at = ?, push_last_error = NULL,
             push_claim_token = NULL, push_claim_expires_at = NULL
         WHERE id = ? AND push_state = 'pending' AND push_claim_token = ?`,
      )
      .run(now, id, claimToken).changes;
    return changes > 0;
  }

  /** Nada a entregar (sem dispositivo vivo ou todos recusaram a assinatura). */
  markSkipped(id: string, claimToken: string): boolean {
    const changes = this.#db
      .prepare<[string, string]>(
        `UPDATE notifications
         SET push_state = 'skipped', push_claim_token = NULL,
             push_claim_expires_at = NULL
         WHERE id = ? AND push_state = 'pending' AND push_claim_token = ?`,
      )
      .run(id, claimToken).changes;
    return changes > 0;
  }

  /**
   * Registra falha de entrega.
   *
   * `terminal=false` devolve a linha para `pending` com o claim liberado, então
   * o próximo ciclo tenta novamente; o limite de tentativas evita loop infinito.
   */
  markFailed(
    id: string,
    claimToken: string,
    error: string,
    terminal: boolean,
  ): boolean {
    const changes = this.#db
      .prepare<[string, string, string]>(
        terminal
          ? `UPDATE notifications
             SET push_state = 'failed', push_last_error = ?,
                 push_claim_token = NULL, push_claim_expires_at = NULL
             WHERE id = ? AND push_state = 'pending' AND push_claim_token = ?`
          : `UPDATE notifications
             SET push_state = 'pending', push_last_error = ?,
                 push_claim_token = NULL, push_claim_expires_at = NULL
             WHERE id = ? AND push_state = 'pending' AND push_claim_token = ?`,
      )
      .run(error, id, claimToken).changes;
    return changes > 0;
  }

  /** Remove assinaturas revogadas antigas (dado operacional, não de domínio). */
  deleteRevokedBefore(cutoff: string): number {
    return this.#db
      .prepare<[string]>(
        "DELETE FROM push_subscriptions WHERE revoked_at IS NOT NULL AND revoked_at <= ?",
      )
      .run(cutoff).changes;
  }
}
