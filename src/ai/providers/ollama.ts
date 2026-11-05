import type { AiConfig } from "../../config.ts";
import { type AiCompletionRequest, type AiProvider, AiProviderError } from "../ai.types.ts";

interface OllamaChatResponse {
  message?: { content?: unknown };
}

interface OllamaEmbedResponse {
  embeddings?: unknown;
}

function trimBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

/** Adapter local (Ollama) — nenhum dado sai da máquina. */
export class OllamaProvider implements AiProvider {
  readonly name = "ollama";
  readonly chatModel: string;
  readonly embeddingsModel: string;
  readonly embeddingDimensions: number;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;

  constructor(config: AiConfig) {
    if (!config.ollamaModel) {
      throw new AiProviderError("AI_MODEL não configurado para o provider Ollama");
    }

    this.#baseUrl = trimBaseUrl(config.ollamaUrl);
    this.#timeoutMs = config.requestTimeoutMs;
    this.chatModel = config.ollamaModel;
    this.embeddingsModel = config.embeddingsModel ?? config.ollamaModel;
    this.embeddingDimensions = config.embeddingDimensions ?? 1536;
  }

  async complete(request: AiCompletionRequest): Promise<string> {
    const data = await this.#post<OllamaChatResponse>("/api/chat", {
      model: this.chatModel,
      stream: false,
      format: "json",
      options: { temperature: 0.2 },
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
    });

    const content = data.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new AiProviderError("Resposta do Ollama sem conteúdo");
    }
    return content;
  }

  async embed(texts: readonly string[]): Promise<readonly number[][]> {
    if (texts.length === 0) return [];

    const data = await this.#post<OllamaEmbedResponse>("/api/embed", {
      model: this.embeddingsModel,
      input: texts,
    });

    if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) {
      throw new AiProviderError("Resposta de embeddings do Ollama incompleta");
    }

    return data.embeddings.map((embedding) => {
      if (!Array.isArray(embedding)) {
        throw new AiProviderError("Embedding inválido na resposta do Ollama");
      }
      return embedding.map((value) => Number(value));
    });
  }

  async #post<T>(path: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.#baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      throw new AiProviderError("Falha de rede no Ollama", undefined, { cause: error });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new AiProviderError(
        `Ollama respondeu ${response.status}: ${text.slice(0, 300)}`,
        response.status,
      );
    }

    try {
      return await response.json() as T;
    } catch (error) {
      throw new AiProviderError("Resposta do Ollama não é JSON", undefined, {
        cause: error,
      });
    }
  }
}
