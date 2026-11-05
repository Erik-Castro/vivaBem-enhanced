import type { AppConfig } from "../config.ts";
import type { AppDatabase } from "../db/client.ts";
import type { Logger } from "../shared/logger/index.ts";
import { uuidv7 } from "../shared/utils/uuid.ts";
import type { EmbeddingSourceType, PublishEventInput } from "./events.types.ts";
import { OutboxRepository } from "./outbox.repository.ts";

export interface EventPublisherDependencies {
  readonly db: AppDatabase;
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly repository?: OutboxRepository;
}

/**
 * Publica eventos de domínio no outbox.
 *
 * Nunca abre uma transação própria: quem chama já está dentro da transação da
 * regra de negócio. Quando a IA está desligada ou o usuário não fez opt-in,
 * retorna `null` sem gravar nada.
 */
export class EventPublisher {
  readonly #db: AppDatabase;
  readonly #config: AppConfig;
  readonly #logger: Logger;
  readonly #now: () => Date;
  readonly #repository: OutboxRepository;

  constructor(dependencies: EventPublisherDependencies) {
    this.#db = dependencies.db;
    this.#config = dependencies.config;
    this.#logger = dependencies.logger;
    this.#now = dependencies.now ?? (() => new Date());
    this.#repository = dependencies.repository ?? new OutboxRepository(dependencies.db);
  }

  isEnabledFor(userId: string): boolean {
    if (!this.#config.ai.enabled) return false;

    const row = this.#db
      .prepare<[string], { ai_enabled: number }>(
        "SELECT ai_enabled FROM user_preferences WHERE user_id = ?",
      )
      .get(userId);

    return row?.ai_enabled === 1;
  }

  publish(input: PublishEventInput): string | null {
    if (!this.isEnabledFor(input.userId)) return null;

    const now = this.#now().toISOString();
    const id = uuidv7(this.#now().getTime());

    try {
      this.#repository.insert({
        id,
        type: input.type,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId ?? null,
        userId: input.userId,
        payload: input.payload ?? {},
        priority: input.priority ?? 0,
        availableAt: input.availableAt ?? now,
        now,
      });
    } catch (error) {
      // O evento é secundário: jamais derrube a regra de negócio por falha no
      // outbox. A transação do chamador continua válida.
      this.#logger.error("event_publish_failed", {
        type: input.type,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

    return id;
  }

  /** Agenda a indexação assíncrona de um conteúdo para busca semântica. */
  requestEmbedding(
    userId: string,
    sourceType: EmbeddingSourceType,
    sourceId: string,
    content: string,
  ): string | null {
    return this.publish({
      type: "embedding.requested",
      aggregateType: sourceType,
      aggregateId: sourceId,
      userId,
      payload: { sourceType, sourceId, content },
      priority: -1,
    });
  }
}
