import type { AppDatabase } from "../db/client.ts";
import type { EmbeddingSourceType } from "../events/events.types.ts";

export interface EmbeddingItem {
  readonly id: string;
  readonly userId: string;
  readonly sourceType: EmbeddingSourceType;
  readonly sourceId: string;
  readonly contentHash: string;
  readonly model: string;
  readonly dimensions: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpsertEmbeddingRecord {
  readonly id: string;
  readonly userId: string;
  readonly sourceType: EmbeddingSourceType;
  readonly sourceId: string;
  readonly contentHash: string;
  readonly embedding: readonly number[];
  readonly model: string;
  readonly dimensions: number;
  readonly now: string;
}

export interface EmbeddingMatch {
  readonly sourceId: string;
  readonly distance: number;
}

/**
 * Acesso à tabela `embedding_items`.
 *
 * `vector_init` é obrigatório em toda conexão que usa busca vetorial. A
 * inicialização é preguiçosa e idempotente por instância; se a extensão não
 * estiver carregada, o repositório se declara indisponível em vez de quebrar.
 */
export class EmbeddingsRepository {
  readonly #db: AppDatabase;
  readonly #dimensions: number;
  #initialized = false;

  constructor(db: AppDatabase, dimensions: number) {
    this.#db = db;
    this.#dimensions = dimensions;
  }

  get available(): boolean {
    return this.#db.vectorEnabled;
  }

  ensureInitialized(): boolean {
    if (!this.available) return false;
    if (this.#initialized) return true;

    this.#db
      .prepare<[string, string, string], unknown>("SELECT vector_init(?, ?, ?)")
      .get(
        "embedding_items",
        "embedding",
        `dimension=${this.#dimensions},type=FLOAT32,distance=cosine,normalized=1`,
      );

    this.#initialized = true;
    return true;
  }

  upsert(record: UpsertEmbeddingRecord): void {
    if (!this.ensureInitialized()) return;

    this.#db
      .prepare<
        [
          string,
          string,
          EmbeddingSourceType,
          string,
          string,
          string,
          string,
          number,
          string,
          string,
        ]
      >(
        `INSERT INTO embedding_items (
           id, user_id, source_type, source_id, content_hash, embedding,
           model, dimensions, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, vector_as_f32(?), ?, ?, ?, ?)
         ON CONFLICT (user_id, source_type, source_id) DO UPDATE SET
           content_hash = excluded.content_hash,
           embedding = excluded.embedding,
           model = excluded.model,
           dimensions = excluded.dimensions,
           updated_at = excluded.updated_at`,
      )
      .run(
        record.id,
        record.userId,
        record.sourceType,
        record.sourceId,
        record.contentHash,
        JSON.stringify(record.embedding),
        record.model,
        record.dimensions,
        record.now,
        record.now,
      );
  }

  /** Busca os insights mais próximos do vetor, sempre restrita ao usuário. */
  searchInsights(
    userId: string,
    queryVector: readonly number[],
    limit: number,
  ): EmbeddingMatch[] {
    if (!this.ensureInitialized()) return [];

    return this.#db
      .prepare<[string, string, number], { source_id: string; distance: number }>(
        `SELECT e.source_id AS source_id, v.distance AS distance
         FROM vector_full_scan('embedding_items', 'embedding', vector_as_f32(?)) AS v
         JOIN embedding_items e ON e.rowid = v.rowid
         WHERE e.user_id = ? AND e.source_type = 'insight'
         ORDER BY v.distance
         LIMIT ?`,
      )
      .all(JSON.stringify(queryVector), userId, limit)
      .map((row) => ({ sourceId: row.source_id, distance: row.distance }));
  }

  deleteBySource(
    userId: string,
    sourceType: EmbeddingSourceType,
    sourceId: string,
  ): void {
    this.#db
      .prepare<[string, EmbeddingSourceType, string]>(
        "DELETE FROM embedding_items WHERE user_id = ? AND source_type = ? AND source_id = ?",
      )
      .run(userId, sourceType, sourceId);
  }
}
