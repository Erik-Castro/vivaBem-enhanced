import type { Logger } from "../../shared/logger/index.ts";
import type { AuthRepository } from "../../modules/auth/auth.repository.ts";
import type { InsightsRepository } from "../../modules/insights/insights.repository.ts";
import type { NotificationsRepository } from "../../modules/notifications/notifications.repository.ts";
import type { IpBlocklistRepository } from "../../modules/security/ip-blocklist.repository.ts";
import { uuidv7 } from "../../shared/utils/uuid.ts";
import type { AiToolContext, AiToolResult } from "../ai.types.ts";
import type {
  InsightCategory,
  InsightSeverity,
} from "../../modules/insights/insights.repository.ts";
import type {
  NotificationCategory,
  NotificationSeverity,
} from "../../modules/notifications/notifications.repository.ts";

export interface AiToolDependencies {
  readonly notifications: NotificationsRepository;
  readonly insights: InsightsRepository;
  readonly auth: AuthRepository;
  readonly blocklist: IpBlocklistRepository;
  readonly logger: Logger;
}

export interface CreateInsightInput {
  readonly category: InsightCategory;
  readonly severity: InsightSeverity;
  readonly title: string;
  readonly message: string;
}

/**
 * Cria um insight e devolve o conteúdo para indexação assíncrona.
 *
 * A deduplicação é feita no banco por `dedupe_key` (id do evento + título):
 * reprocessar o mesmo evento não cria outro insight nem reindexa o conteúdo.
 */
export function createInsight(
  dependencies: AiToolDependencies,
  context: AiToolContext,
  input: CreateInsightInput,
): AiToolResult {
  const { insight, created } = dependencies.insights.createIfAbsent({
    id: uuidv7(),
    userId: context.userId,
    category: input.category,
    severity: input.severity,
    title: input.title,
    message: input.message,
    sourceEvent: context.sourceEvent,
    confidence: context.confidence,
    now: context.now,
    dedupeKey: `${context.eventId}:${input.title}`,
  });

  if (!created) {
    return {
      success: true,
      message: "Insight já existente",
      data: { id: insight.id, deduplicated: true },
    };
  }

  return {
    success: true,
    message: "Insight criado",
    data: { id: insight.id },
    embedding: {
      sourceType: "insight",
      sourceId: insight.id,
      content: `${insight.title}\n${insight.message}`,
    },
  };
}

export interface NotifyInput {
  readonly category: NotificationCategory;
  readonly severity: NotificationSeverity;
  readonly title: string;
  readonly message: string;
  readonly link?: string | null;
}

/**
 * Notifica o usuário com deduplicação por evento.
 *
 * A chave inclui o id do evento: reprocessar a mesma entrega não cria outro
 * aviso, mas eventos distintos com o mesmo texto continuam gerando notificação.
 */
export function notify(
  dependencies: AiToolDependencies,
  context: AiToolContext,
  input: NotifyInput,
): AiToolResult {
  const { notification, created } = dependencies.notifications.createIfAbsent({
    id: uuidv7(),
    userId: context.userId,
    title: input.title,
    message: input.message,
    category: input.category,
    severity: input.severity,
    link: input.link ?? null,
    now: context.now,
    dedupeKey: `${context.eventId}:${input.title}`,
  });

  if (!created) {
    return {
      success: true,
      message: "Notificação já existente",
      data: { id: notification.id, deduplicated: true },
    };
  }

  return {
    success: true,
    message: "Usuário notificado",
    data: { id: notification.id },
  };
}

export function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

export function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function asSeverity(
  value: unknown,
  fallback: InsightSeverity = "low",
): InsightSeverity {
  return value === "medium" || value === "high" || value === "critical" ? value : fallback;
}
