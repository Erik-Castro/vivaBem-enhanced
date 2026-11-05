import { z } from "zod";

/**
 * Tipos de evento aceitos pelo outbox. A lista é fechada de propósito: o worker
 * escolhe prompt e context builder por prefixo, então um tipo desconhecido não
 * pode entrar na fila.
 */
export const EVENT_TYPES = [
  "finance.transaction.created",
  "finance.transaction.updated",
  "finance.transaction.deleted",
  "finance.transaction.cleared",
  "finance.transfer.created",
  "finance.budget.created",
  "finance.budget.updated",
  "finance.goal.contribution.created",
  "habit.created",
  "habit.log.created",
  "habit.log.updated",
  "habit.log.deleted",
  "investment.transaction.created",
  "investment.quote.created",
  "recurring.occurrence.materialized",
  "security.login_failed",
  "security.login_success",
  "security.session_reuse",
  "correlation.check",
  "embedding.requested",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_STATUSES = ["pending", "processing", "completed", "failed"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** Payload é JSON livre, mas sempre um objeto — nunca array ou escalar. */
export const EventPayloadSchema = z.record(z.string(), z.unknown());
export type EventPayload = z.infer<typeof EventPayloadSchema>;

export const EMBEDDING_SOURCE_TYPES = [
  "transaction",
  "habit",
  "habit_log",
  "insight",
  "goal",
  "investment",
] as const;

export type EmbeddingSourceType = (typeof EMBEDDING_SOURCE_TYPES)[number];

export interface OutboxEvent {
  readonly id: string;
  readonly type: EventType;
  readonly aggregateType: string;
  readonly aggregateId: string | null;
  readonly userId: string;
  readonly payload: EventPayload;
  readonly status: EventStatus;
  readonly priority: number;
  readonly attempts: number;
  readonly availableAt: string;
  readonly lockedAt: string | null;
  readonly workerId: string | null;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly processedAt: string | null;
}

export interface PublishEventInput {
  readonly type: EventType;
  readonly aggregateType: string;
  readonly aggregateId?: string | null;
  readonly userId: string;
  readonly payload?: EventPayload;
  readonly priority?: number;
  /** Quando informado, o evento só fica disponível a partir deste instante. */
  readonly availableAt?: string;
}

export interface OutboxStats {
  readonly pending: number;
  readonly processing: number;
  readonly completed: number;
  readonly failed: number;
}

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

/** Converte o payload persistido em objeto; payload corrompido vira `{}`. */
export function parseEventPayload(raw: string): EventPayload {
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = EventPayloadSchema.safeParse(parsed);
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}
