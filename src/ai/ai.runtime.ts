import type { AiConfigSource } from "../config.ts";
import type { AppDatabase } from "../db/client.ts";
import type { Logger } from "../shared/logger/index.ts";
import { EventPublisher } from "../events/event-publisher.ts";
import { AuthRepository } from "../modules/auth/auth.repository.ts";
import { InsightsRepository } from "../modules/insights/insights.repository.ts";
import { NotificationsRepository } from "../modules/notifications/notifications.repository.ts";
import { IpBlocklistRepository } from "../modules/security/ip-blocklist.repository.ts";
import { createAiProvider } from "./providers/factory.ts";
import { createContextRegistry } from "./ai.context.ts";
import { AiProcessor } from "./ai.processor.ts";
import { AiToolExecutor } from "./ai.executor.ts";
import { CorrelationScheduler } from "./ai.correlation.ts";
import { EmbeddingsService } from "./embeddings.service.ts";
import { createAiToolRegistry } from "./tools/index.ts";

export interface AiRuntimeOptions {
  readonly db: AppDatabase;
  readonly config: AiConfigSource;
  readonly logger: Logger;
}

/** Pipeline completo consumido pelo worker. */
export interface AiPipeline {
  readonly processor: AiProcessor;
  readonly correlations: CorrelationScheduler;
}

/**
 * Cria apenas o serviço de embeddings.
 *
 * A API usa esta fatia para busca semântica; ela não instancia processor,
 * executor nem consumidor de outbox.
 */
export function createEmbeddingsService(options: AiRuntimeOptions): EmbeddingsService {
  return new EmbeddingsService({
    db: options.db,
    provider: createAiProvider(options.config),
    logger: options.logger,
  });
}

/**
 * Monta o pipeline do Event Intelligence Engine.
 *
 * Retorna `null` quando `AI_ENABLED=false`: nenhum provider é construído e o
 * worker encerra com `worker_disabled`. Chamadas externas continuam fora de
 * qualquer transação de escrita — a composição não abre transação.
 */
export function createAiPipeline(options: AiRuntimeOptions): AiPipeline | null {
  const provider = createAiProvider(options.config);
  if (provider === null) return null;

  const { db, config, logger } = options;
  const publisher = new EventPublisher({ db, config, logger });
  const embeddings = new EmbeddingsService({ db, provider, logger });
  const registry = createAiToolRegistry({
    notifications: new NotificationsRepository(db),
    insights: new InsightsRepository(db),
    auth: new AuthRepository(db),
    blocklist: new IpBlocklistRepository(db),
    logger,
  });
  const executor = new AiToolExecutor({ db, config, logger, registry, publisher });
  const processor = new AiProcessor({
    config,
    logger,
    provider,
    contexts: createContextRegistry(db),
    executor,
    embeddings,
  });
  const correlations = new CorrelationScheduler({
    db,
    publisher,
    threshold: config.ai.correlationThreshold,
  });

  logger.info("ai_runtime_ready", {
    provider: provider.name,
    chatModel: provider.chatModel,
    embeddingsModel: provider.embeddingsModel,
    dimensions: provider.embeddingDimensions,
    vectorEnabled: db.vectorEnabled,
  });

  return { processor, correlations };
}
