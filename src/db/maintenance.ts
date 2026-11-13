import type { AppDatabase } from "./client.ts";

/** Eventos concluídos são operacionais; manter 30 dias basta para auditoria. */
export const DEFAULT_EVENT_RETENTION_DAYS = 30;

export interface MaintenanceOptions {
  readonly now?: Date;
  readonly eventRetentionDays?: number;
}

export interface MaintenanceResult {
  readonly expiredSessions: number;
  readonly completedEvents: number;
  readonly expiredIpBlocks: number;
  readonly orphanEmbeddings: number;
  readonly revokedPushSubscriptions: number;
}

/**
 * Limpeza periódica de dados operacionais.
 *
 * Nunca remove dados de domínio do usuário: apenas sessões já expiradas,
 * eventos de outbox concluídos, bloqueios de IP vencidos, embeddings cujo
 * insight de origem não existe mais e assinaturas push já revogadas.
 */
export function runMaintenance(
  db: AppDatabase,
  options: MaintenanceOptions = {},
): MaintenanceResult {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const retentionDays = options.eventRetentionDays ?? DEFAULT_EVENT_RETENTION_DAYS;
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();

  return db.transaction(() => {
    const expiredSessions = db
      .prepare<[string]>("DELETE FROM user_sessions WHERE expires_at <= ?")
      .run(nowIso).changes;

    const completedEvents = db
      .prepare<[string]>(
        `DELETE FROM event_outbox
         WHERE status = 'completed' AND processed_at IS NOT NULL AND processed_at <= ?`,
      )
      .run(cutoff).changes;

    const expiredIpBlocks = db
      .prepare<[string]>("DELETE FROM ip_blocklist WHERE expires_at <= ?")
      .run(nowIso).changes;

    const orphanEmbeddings = db
      .prepare<[]>(
        `DELETE FROM embedding_items
         WHERE source_type = 'insight'
           AND NOT EXISTS (
             SELECT 1 FROM ai_insights i
             WHERE i.id = embedding_items.source_id
               AND i.user_id = embedding_items.user_id
           )`,
      )
      .run().changes;

    // A assinatura revogada só serve para auditoria recente; o endpoint já não
    // recebe entrega e o usuário pode reassinar quando quiser.
    const revokedPushSubscriptions = db
      .prepare<[string]>(
        "DELETE FROM push_subscriptions WHERE revoked_at IS NOT NULL AND revoked_at <= ?",
      )
      .run(cutoff).changes;

    return {
      expiredSessions,
      completedEvents,
      expiredIpBlocks,
      orphanEmbeddings,
      revokedPushSubscriptions,
    };
  });
}
