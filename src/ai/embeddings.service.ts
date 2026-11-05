import type { AppDatabase } from "../db/client.ts";
import type { Logger } from "../shared/logger/index.ts";
import { sha256Hex } from "../shared/crypto/tokens.ts";
import { uuidv7 } from "../shared/utils/uuid.ts";
import type { OutboxEvent } from "../events/events.types.ts";
import { EMBEDDING_SOURCE_TYPES, type EmbeddingSourceType } from "../events/events.types.ts";
import type { AiProvider } from "./ai.types.ts";
import { EmbeddingsRepository } from "./embeddings.repository.ts";

export interface EmbeddingsServiceDependencies {
  readonly db: AppDatabase;
  readonly provider: AiProvider | null;
  readonly logger: Logger;
}

export interface EmbeddingsSearchResult {
  readonly sourceId: string;
  readonly distance: number;
}

/**
 * Gera e consulta embeddings.
 *
 * A indexação nunca acontece no caminho da resposta HTTP: os serviços publicam
 * `embedding.requested` no outbox e o worker chama `processRequest`. A busca é
 * uma leitura síncrona porque a API precisa ordenar os resultados na hora.
 */
export class EmbeddingsService {
  readonly #db: AppDatabase;
  readonly #provider: AiProvider | null;
  readonly #logger: Logger;
  readonly #repository: EmbeddingsRepository | null;

  constructor(dependencies: EmbeddingsServiceDependencies) {
    this.#db = dependencies.db;
    this.#provider = dependencies.provider;
    this.#logger = dependencies.logger;
    this.#repository = dependencies.provider !== null && dependencies.db.vectorEnabled
      ? new EmbeddingsRepository(dependencies.db, dependencies.provider.embeddingDimensions)
      : null;
  }

  get enabled(): boolean {
    return this.#repository !== null;
  }

  async processRequest(event: OutboxEvent): Promise<void> {
    if (this.#provider === null || this.#repository === null) return;

    const sourceType = event.payload.sourceType;
    const sourceId = event.payload.sourceId;
    const content = event.payload.content;

    if (
      typeof sourceType !== "string" ||
      !(EMBEDDING_SOURCE_TYPES as readonly string[]).includes(sourceType) ||
      typeof sourceId !== "string" ||
      typeof content !== "string" ||
      content.trim() === ""
    ) {
      throw new Error("Evento de embedding com payload inválido");
    }

    const [vector] = await this.#provider.embed([content.slice(0, 20_000)]);
    if (vector === undefined || vector.length === 0) {
      throw new Error("Provider não retornou embedding");
    }

    const normalized = normalizeVector(vector);
    const now = new Date().toISOString();

    this.#repository.upsert({
      id: uuidv7(),
      userId: event.userId,
      sourceType: sourceType as EmbeddingSourceType,
      sourceId,
      contentHash: await sha256Hex(content),
      embedding: normalized,
      model: this.#provider.embeddingsModel,
      dimensions: normalized.length,
      now,
    });
  }

  async searchInsights(
    userId: string,
    query: string,
    limit: number,
  ): Promise<EmbeddingsSearchResult[]> {
    if (this.#provider === null || this.#repository === null) return [];

    const trimmed = query.trim();
    if (trimmed === "") return [];

    try {
      const [vector] = await this.#provider.embed([trimmed]);
      if (vector === undefined || vector.length === 0) return [];

      return this.#repository.searchInsights(userId, normalizeVector(vector), limit);
    } catch (error) {
      // Busca semântica é um extra: se o provider falhar, a API cai para a
      // busca textual em vez de responder erro.
      this.#logger.warn("embedding_search_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /** Mantém o método disponível para manutenção/limpeza de índices. */
  deleteBySource(userId: string, sourceType: EmbeddingSourceType, sourceId: string): void {
    this.#repository?.deleteBySource(userId, sourceType, sourceId);
  }

  get database(): AppDatabase {
    return this.#db;
  }
}

/** Normaliza L2 para casar com `normalized=1` declarado em `vector_init`. */
export function normalizeVector(vector: readonly number[]): number[] {
  const magnitude = Math.sqrt(
    vector.reduce((total, value) => total + value * value, 0),
  );
  if (magnitude === 0) return [...vector];
  return vector.map((value) => value / magnitude);
}
