import { AiToolRegistry } from "../ai.registry.ts";
import type { AiToolDependencies } from "./deps.ts";
import { registerCorrelationTools } from "./correlation.ts";
import { registerFinanceTools } from "./finance.ts";
import { registerHabitTools } from "./habit.ts";
import { registerInvestmentTools } from "./investment.ts";
import { registerSecurityTools } from "./security.ts";

/**
 * Monta o registry completo de ferramentas. A ordem importa apenas para o
 * prompt: as tools são descritas em blocos por categoria.
 */
export function createAiToolRegistry(dependencies: AiToolDependencies): AiToolRegistry {
  const registry = new AiToolRegistry();

  registerSecurityTools(registry, dependencies);
  registerFinanceTools(registry, dependencies);
  registerHabitTools(registry, dependencies);
  registerInvestmentTools(registry, dependencies);
  registerCorrelationTools(registry, dependencies);

  return registry;
}
