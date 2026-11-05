import type { AiToolDefinition } from "./ai.types.ts";

/**
 * Registro fechado de ferramentas da IA.
 *
 * O LLM nunca executa SQL: ele só pode chamar tools registradas aqui. Um nome
 * desconhecido é ignorado pelo executor e auditado como tentativa bloqueada.
 */
export class AiToolRegistry {
  readonly #tools = new Map<string, AiToolDefinition>();

  register(tool: AiToolDefinition): void {
    if (this.#tools.has(tool.name)) {
      throw new Error(`Ferramenta já registrada: ${tool.name}`);
    }
    this.#tools.set(tool.name, tool);
  }

  get(name: string): AiToolDefinition | undefined {
    return this.#tools.get(name);
  }

  all(): AiToolDefinition[] {
    return [...this.#tools.values()];
  }

  names(): string[] {
    return [...this.#tools.keys()];
  }

  byCategory(category: AiToolDefinition["category"]): AiToolDefinition[] {
    return this.all().filter((tool) => tool.category === category);
  }
}
