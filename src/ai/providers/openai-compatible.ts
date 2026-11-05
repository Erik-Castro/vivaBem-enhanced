import type { AiConfig } from "../../config.ts";
import { type AiCompletionRequest, type AiProvider, AiProviderError } from "../ai.types.ts";

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
}

interface EmbeddingsResponse {
  data?: Array<{ embedding?: unknown; index?: number }>;
}

function trimBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Provider OpenAI-compatible (OpenAI, OpenRouter, vLLM, llama.cpp server…).
 * Usa `fetch` nativo, com timeout e sem retry — o retry é responsabilidade do
 * worker, que aplica backoff.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly name = "openai";
  readonly chatModel: string;
  readonly embeddingsModel: string;
  readonly embeddingDimensions: number;
  readonly #baseUrl: string;
  readonly #apiKey?: string;
  readonly #timeoutMs: number;

  constructor(config: AiConfig) {
    if (!config.apiBaseUrl) {
      throw new AiProviderError("AI_API_BASE_URL não configurada");
    }
    if (!config.chatModel || !config.embeddingsModel) {
      throw new AiProviderError("Modelos de chat/embeddings não configurados");
    }

    this.#baseUrl = trimBaseUrl(config.apiBaseUrl);
    this.#apiKey = config.apiKey;
    this.#timeoutMs = config.requestTimeoutMs;
    this.chatModel = config.chatModel;
    this.embeddingsModel = config.embeddingsModel;
    this.embeddingDimensions = config.embeddingDimensions ?? 1536;
  }

  async complete(request: AiCompletionRequest): Promise<string> {
    const body = {
      model: this.chatModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: request.systemPrompt },
        {
          role: "user",
          content: JSON.stringify({
            context: request.context,
            event: request.event,
          }),
        },
      ],
    };

    const data = await this.#post<ChatCompletionResponse>("/chat/completions", body);
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new AiProviderError("Resposta de chat sem conteúdo");
    }
    return content;
  }

  async embed(texts: readonly string[]): Promise<readonly number[][]> {
    if (texts.length === 0) return [];

    const data = await this.#post<EmbeddingsResponse>("/embeddings", {
      model: this.embeddingsModel,
      input: texts,
    });

    if (!Array.isArray(data.data) || data.data.length !== texts.length) {
      throw new AiProviderError("Resposta de embeddings incompleta");
    }

    const ordered = [...data.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return ordered.map((item) => {
      if (!Array.isArray(item.embedding)) {
        throw new AiProviderError("Embedding inválido na resposta");
      }
      return item.embedding.map((value) => Number(value));
    });
  }

  async #post<T>(path: string, body: unknown): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.#apiKey) headers.Authorization = `Bearer ${this.#apiKey}`;

    let response: Response;
    try {
      response = await fetch(`${this.#baseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      throw new AiProviderError("Falha de rede no provider de IA", undefined, {
        cause: error,
      });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new AiProviderError(
        `Provider de IA respondeu ${response.status}: ${text.slice(0, 300)}`,
        response.status,
      );
    }

    try {
      return await response.json() as T;
    } catch (error) {
      throw new AiProviderError("Resposta do provider não é JSON", undefined, {
        cause: error,
      });
    }
  }
}
