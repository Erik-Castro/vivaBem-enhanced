import type { AppConfig } from "../../config.ts";
import type { AiProvider } from "../ai.types.ts";
import { OllamaProvider } from "./ollama.ts";
import { OpenAiCompatibleProvider } from "./openai-compatible.ts";

/** Retorna `null` quando a IA está desligada: nenhum provider é construído. */
export function createAiProvider(config: AppConfig): AiProvider | null {
  if (!config.ai.enabled) return null;

  return config.ai.provider === "ollama"
    ? new OllamaProvider(config.ai)
    : new OpenAiCompatibleProvider(config.ai);
}
