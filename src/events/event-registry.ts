import { z } from "zod";
import {
  EMBEDDING_SOURCE_TYPES,
  type EventPayload,
  EventPayloadSchema,
  type EventType,
  type OutboxEvent,
} from "./events.types.ts";
import { EventPayloadError, PermanentEventError } from "./errors.ts";

/**
 * Descritor de um tipo de evento.
 *
 * O registro é a fronteira entre o transporte (outbox) e o processamento: o
 * pipeline não escolhe nada por prefixo de string sem antes consultar aqui.
 */
export interface EventDescriptor {
  readonly type: EventType;
  /** Versão do contrato de payload. Evoluções incompatíveis sobem este número. */
  readonly schemaVersion: number;
  /** Pipeline que consome o evento. */
  readonly pipeline: "ai" | "embedding";
  /** Eventos internos não disparam nova avaliação de correlação. */
  readonly internal: boolean;
  /** Valida o payload bruto antes de entregá-lo ao handler. */
  readonly payload: z.ZodType<EventPayload>;
  readonly description: string;
}

const securityPayload = z.looseObject({
  email: z.string().optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
});

const correlationPayload = z.looseObject({
  patternType: z.string().min(1),
});

const embeddingPayload = z.looseObject({
  sourceType: z.enum(EMBEDDING_SOURCE_TYPES),
  sourceId: z.string().min(1),
  content: z.string().min(1),
});

/**
 * Payloads financeiros são informativos: o contexto é sempre recalculado a
 * partir do banco usando `userId`/`aggregateId` do evento. Validamos apenas a
 * forma de objeto, preservando eventos antigos e mantendo o LLM sem acesso a
 * dados não confirmados pelo repositório.
 */
const informationalPayload = EventPayloadSchema;

/**
 * Catálogo fechado de tipos suportados.
 *
 * `satisfies Record<EventType, EventDescriptor>` garante em tempo de compilação
 * que todo tipo novo ganhe um descritor — sem isso o worker aceitaria um evento
 * que não sabe processar.
 */
export const EVENT_REGISTRY = {
  "finance.transaction.created": {
    type: "finance.transaction.created",
    schemaVersion: 1,
    pipeline: "ai",
    internal: false,
    payload: informationalPayload,
    description: "Transação financeira criada",
  },
  "finance.transaction.updated": {
    type: "finance.transaction.updated",
    schemaVersion: 1,
    pipeline: "ai",
    internal: false,
    payload: informationalPayload,
    description: "Transação financeira atualizada",
  },
  "finance.transaction.deleted": {
    type: "finance.transaction.deleted",
    schemaVersion: 1,
    pipeline: "ai",
    internal: false,
    payload: informationalPayload,
    description: "Transação financeira removida",
  },
  "finance.transaction.cleared": {
    type: "finance.transaction.cleared",
    schemaVersion: 1,
    pipeline: "ai",
    internal: false,
    payload: informationalPayload,
    description: "Transação financeira compensada",
  },
  "finance.transfer.created": {
    type: "finance.transfer.created",
    schemaVersion: 1,
    pipeline: "ai",
    internal: false,
    payload: informationalPayload,
    description: "Transferência entre contas criada",
  },
  "finance.transaction.imported": {
    type: "finance.transaction.imported",
    schemaVersion: 1,
    pipeline: "ai",
    internal: false,
    payload: informationalPayload,
    description: "Lote de transações importado",
  },
  "finance.budget.created": {
    type: "finance.budget.created",
    schemaVersion: 1,
    pipeline: "ai",
    internal: false,
    payload: informationalPayload,
    description: "Orçamento criado",
  },
  "finance.budget.updated": {
    type: "finance.budget.updated",
    schemaVersion: 1,
    pipeline: "ai",
    internal: false,
    payload: informationalPayload,
    description: "Orçamento atualizado",
  },
  "finance.goal.contribution.created": {
    type: "finance.goal.contribution.created",
    schemaVersion: 1,
    pipeline: "ai",
    internal: false,
    payload: informationalPayload,
    description: "Contribuição de meta registrada",
  },
  "habit.created": {
    type: "habit.created",
    schemaVersion: 1,
    pipeline: "ai",
    internal: false,
    payload: informationalPayload,
    description: "Hábito criado",
  },
  "habit.log.created": {
    type: "habit.log.created",
    schemaVersion: 1,
    pipeline: "ai",
    internal: false,
    payload: informationalPayload,
    description: "Registro diário de hábito criado",
  },
  "habit.log.updated": {
    type: "habit.log.updated",
    schemaVersion: 1,
    pipeline: "ai",
    internal: false,
    payload: informationalPayload,
    description: "Registro diário de hábito atualizado",
  },
  "habit.log.deleted": {
    type: "habit.log.deleted",
    schemaVersion: 1,
    pipeline: "ai",
    internal: false,
    payload: informationalPayload,
    description: "Registro diário de hábito removido",
  },
  "investment.transaction.created": {
    type: "investment.transaction.created",
    schemaVersion: 1,
    pipeline: "ai",
    internal: false,
    payload: informationalPayload,
    description: "Operação de investimento registrada",
  },
  "investment.quote.created": {
    type: "investment.quote.created",
    schemaVersion: 1,
    pipeline: "ai",
    internal: false,
    payload: informationalPayload,
    description: "Cotação de investimento registrada",
  },
  "recurring.occurrence.materialized": {
    type: "recurring.occurrence.materialized",
    schemaVersion: 1,
    pipeline: "ai",
    internal: false,
    payload: informationalPayload,
    description: "Ocorrência de recorrência materializada",
  },
  "security.login_failed": {
    type: "security.login_failed",
    schemaVersion: 1,
    pipeline: "ai",
    internal: false,
    payload: securityPayload,
    description: "Falha de autenticação",
  },
  "security.login_success": {
    type: "security.login_success",
    schemaVersion: 1,
    pipeline: "ai",
    internal: false,
    payload: securityPayload,
    description: "Autenticação bem-sucedida",
  },
  "security.session_reuse": {
    type: "security.session_reuse",
    schemaVersion: 1,
    pipeline: "ai",
    internal: false,
    payload: securityPayload,
    description: "Reuso de refresh token detectado",
  },
  "correlation.check": {
    type: "correlation.check",
    schemaVersion: 1,
    pipeline: "ai",
    internal: true,
    payload: correlationPayload,
    description: "Análise de correlação entre domínios",
  },
  "embedding.requested": {
    type: "embedding.requested",
    schemaVersion: 1,
    pipeline: "embedding",
    internal: true,
    payload: embeddingPayload,
    description: "Indexação assíncrona de embedding",
  },
} as const satisfies Record<EventType, EventDescriptor>;

/** Devolve o descritor do tipo ou `null` quando o tipo é desconhecido. */
export function findEventDescriptor(type: string): EventDescriptor | null {
  return Object.hasOwn(EVENT_REGISTRY, type) ? EVENT_REGISTRY[type as EventType] : null;
}

/** Exige um descritor; tipo desconhecido é falha permanente. */
export function requireEventDescriptor(type: string): EventDescriptor {
  const descriptor = findEventDescriptor(type);
  if (descriptor === null) {
    throw new PermanentEventError(`Tipo de evento não suportado: ${type}`);
  }
  return descriptor;
}

/**
 * Valida o payload antes da entrega ao handler.
 *
 * @throws {PermanentEventError} quando o tipo não está registrado.
 * @throws {EventPayloadError} quando o payload não respeita o contrato.
 */
export function validateEventPayload(event: OutboxEvent): EventPayload {
  const descriptor = requireEventDescriptor(event.type);
  const result = descriptor.payload.safeParse(event.payload);
  if (!result.success) {
    throw new EventPayloadError(
      `Payload inválido para ${event.type}: ${
        result.error.issues.map((issue) => issue.path.join(".") || "payload").join(", ")
      }`,
      { cause: result.error },
    );
  }
  return result.data;
}

/** `true` para eventos que não devem disparar nova análise de correlação. */
export function isInternalEvent(type: string): boolean {
  return findEventDescriptor(type)?.internal ?? false;
}
