import type { AiConfigSource } from "../config.ts";
import type { Logger } from "../shared/logger/index.ts";
import type { OutboxEvent } from "../events/events.types.ts";
import { requireEventDescriptor, validateEventPayload } from "../events/event-registry.ts";
import type { AiContextRegistry } from "./ai.context.ts";
import type { AiProvider } from "./ai.types.ts";
import type { AiToolExecutor } from "./ai.executor.ts";
import type { EmbeddingsService } from "./embeddings.service.ts";
import { parseAiResponse } from "./ai.parser.ts";
import { getPromptForEvent } from "./ai.prompts.ts";
import { redactForProvider } from "./ai.redaction.ts";

export interface AiProcessorDependencies {
  readonly config: AiConfigSource;
  readonly logger: Logger;
  readonly provider: AiProvider;
  readonly contexts: AiContextRegistry;
  readonly executor: AiToolExecutor;
  readonly embeddings: EmbeddingsService;
  readonly now?: () => Date;
}

export interface AiProcessingResult {
  readonly processed: boolean;
  readonly toolCalls: number;
  readonly executed: number;
}

/**
 * Converte um evento do outbox em chamadas de ferramenta.
 *
 * O fluxo é sempre o mesmo: indexar embedding (quando for o caso), montar
 * contexto via services de domínio, redigir PII, chamar o provider, validar a
 * resposta e delegar a execução ao executor auditado.
 */
export class AiProcessor {
  readonly #config: AiConfigSource;
  readonly #logger: Logger;
  readonly #provider: AiProvider;
  readonly #contexts: AiContextRegistry;
  readonly #executor: AiToolExecutor;
  readonly #embeddings: EmbeddingsService;
  readonly #now: () => Date;

  constructor(dependencies: AiProcessorDependencies) {
    this.#config = dependencies.config;
    this.#logger = dependencies.logger;
    this.#provider = dependencies.provider;
    this.#contexts = dependencies.contexts;
    this.#executor = dependencies.executor;
    this.#embeddings = dependencies.embeddings;
    this.#now = dependencies.now ?? (() => new Date());
  }

  async process(event: OutboxEvent): Promise<AiProcessingResult> {
    const descriptor = requireEventDescriptor(event.type);
    validateEventPayload(event);

    if (descriptor.pipeline === "embedding") {
      await this.#embeddings.processRequest(event);
      return { processed: true, toolCalls: 0, executed: 0 };
    }

    let context: Record<string, unknown> | null;
    try {
      context = this.#contexts.build(event);
    } catch (error) {
      // Contexto ausente (ex.: padrão de correlação que desapareceu) é
      // definitivo: repetir o evento não vai mudar o resultado.
      this.#logger.warn("ai_context_unavailable", {
        eventId: event.id,
        type: event.type,
        message: error instanceof Error ? error.message : String(error),
      });
      return { processed: true, toolCalls: 0, executed: 0 };
    }

    if (context === null) {
      this.#logger.debug("ai_context_missing", {
        eventId: event.id,
        type: event.type,
      });
      return { processed: true, toolCalls: 0, executed: 0 };
    }

    const now = this.#now().toISOString();
    const rawResponse = await this.#provider.complete({
      systemPrompt: getPromptForEvent(event.type),
      context: redactForProvider(context) as Record<string, unknown>,
      event: redactForProvider({
        id: event.id,
        type: event.type,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: event.payload,
      }) as Record<string, unknown>,
    });

    const response = parseAiResponse(rawResponse);
    const summary = await this.#executor.execute(response, {
      userId: event.userId,
      eventId: event.id,
      confidence: response.confidence,
      sourceEvent: event.type,
      now,
    });

    this.#logger.info("ai_event_processed", {
      eventId: event.id,
      type: event.type,
      confidence: response.confidence,
      risk: response.analysis.risk,
      toolCalls: summary.attempted,
      executed: summary.executed,
      skipped: summary.skipped,
    });

    return {
      processed: true,
      toolCalls: summary.attempted,
      executed: summary.executed,
    };
  }

  get confidenceThreshold(): number {
    return this.#config.ai.confidenceThreshold;
  }
}
