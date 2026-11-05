import { AppError } from "../../http/errors.ts";
import type { EmbeddingsService } from "../../ai/embeddings.service.ts";
import type {
  AiInsight,
  FeedbackRating,
  InsightFeedback,
  InsightPage,
  InsightsRepository,
  ListInsightsOptions,
} from "./insights.repository.ts";
import { uuidv7 } from "../../shared/utils/uuid.ts";

export interface InsightsServiceDependencies {
  readonly repository: InsightsRepository;
  readonly embeddings?: EmbeddingsService | null;
}

export interface SubmitFeedbackInput {
  readonly rating: FeedbackRating;
  readonly comment?: string | null;
}

export class InsightsService {
  readonly #repository: InsightsRepository;
  readonly #embeddings: EmbeddingsService | null;

  constructor(dependencies: InsightsServiceDependencies) {
    this.#repository = dependencies.repository;
    this.#embeddings = dependencies.embeddings ?? null;
  }

  list(userId: string, options: ListInsightsOptions): InsightPage {
    return this.#repository.list(userId, options);
  }

  get(userId: string, id: string): AiInsight {
    const insight = this.#repository.findById(userId, id);
    if (insight === null) {
      throw new AppError("NOT_FOUND", "Insight não encontrado");
    }
    return insight;
  }

  markRead(userId: string, id: string): AiInsight {
    const insight = this.#repository.markRead(userId, id);
    if (insight === null) {
      throw new AppError("NOT_FOUND", "Insight não encontrado");
    }
    return insight;
  }

  markAllRead(userId: string): number {
    return this.#repository.markAllRead(userId);
  }

  unreadCount(userId: string): number {
    return this.#repository.countUnread(userId);
  }

  submitFeedback(
    userId: string,
    insightId: string,
    input: SubmitFeedbackInput,
  ): InsightFeedback {
    // Garante que o insight pertence ao usuário antes de gravar o feedback.
    this.get(userId, insightId);

    return this.#repository.upsertFeedback({
      id: uuidv7(),
      insightId,
      userId,
      rating: input.rating,
      comment: input.comment ?? null,
      now: new Date().toISOString(),
    });
  }

  /**
   * Busca semântica com fallback textual. O fallback existe porque a IA é
   * opt-in e porque a indexação é assíncrona: um insight recém-criado pode
   * ainda não ter embedding.
   */
  async search(userId: string, query: string, limit: number): Promise<AiInsight[]> {
    const trimmed = query.trim();
    if (trimmed === "") return [];

    if (this.#embeddings !== null) {
      const matches = await this.#embeddings.searchInsights(userId, trimmed, limit);
      if (matches.length > 0) {
        const byId = new Map(
          this.#repository
            .findByIds(userId, matches.map((match) => match.sourceId))
            .map((insight) => [insight.id, insight]),
        );

        const ordered = matches
          .map((match) => byId.get(match.sourceId))
          .filter((insight): insight is AiInsight => insight !== undefined);

        if (ordered.length > 0) return ordered;
      }
    }

    return this.#repository.searchByText(userId, trimmed, limit);
  }
}
