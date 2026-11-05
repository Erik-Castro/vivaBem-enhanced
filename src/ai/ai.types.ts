import type { z } from "zod";
import type { EmbeddingSourceType } from "../events/events.types.ts";

export const AI_RISKS = ["low", "medium", "high"] as const;
export type AiRisk = (typeof AI_RISKS)[number];

export interface AiToolCall {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface AiResponse {
  readonly confidence: number;
  readonly analysis: {
    readonly risk: AiRisk;
    readonly summary: string;
  };
  readonly toolCalls: readonly AiToolCall[];
}

export interface AiCompletionRequest {
  readonly systemPrompt: string;
  readonly context: Record<string, unknown>;
  readonly event: Record<string, unknown>;
}

/**
 * Contrato mínimo de provider. O processor só conhece esta interface, então os
 * testes usam um provider fake determinístico sem tocar a rede.
 */
export interface AiProvider {
  readonly name: string;
  readonly chatModel: string;
  readonly embeddingsModel: string;
  readonly embeddingDimensions: number;
  complete(request: AiCompletionRequest): Promise<string>;
  embed(texts: readonly string[]): Promise<readonly number[][]>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    options: { cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "AiProviderError";
  }
}

export interface AiToolContext {
  readonly userId: string;
  readonly eventId: string;
  readonly confidence: number;
  readonly sourceEvent: string;
  readonly now: string;
}

export interface AiToolResult {
  readonly success: boolean;
  readonly message: string;
  readonly data?: unknown;
  /** Quando presente, o executor indexa o conteúdo criado. */
  readonly embedding?: {
    readonly sourceType: EmbeddingSourceType;
    readonly sourceId: string;
    readonly content: string;
  };
}

export interface AiToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly category:
    | "security"
    | "finance"
    | "habit"
    | "investment"
    | "correlation";
  readonly risk: AiRisk;
  readonly parameters: z.ZodType<Record<string, unknown>>;
  /** Intervalo mínimo entre execuções bem-sucedidas da mesma tool. */
  readonly cooldownSeconds: number;
  readonly executor: (
    args: Record<string, unknown>,
    context: AiToolContext,
  ) => AiToolResult | Promise<AiToolResult>;
}

export interface AiActionLogRecord {
  readonly id: string;
  readonly eventId: string;
  readonly userId: string;
  readonly tool: string;
  readonly arguments: Record<string, unknown>;
  readonly confidence: number;
  readonly executed: boolean;
  readonly executionTimeMs: number;
  readonly error: string | null;
  readonly createdAt: string;
}
