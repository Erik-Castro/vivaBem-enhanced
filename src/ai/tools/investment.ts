import { z } from "zod";
import type { AiToolRegistry } from "../ai.registry.ts";
import { type AiToolDependencies, asOptionalString, asString, createInsight } from "./deps.ts";

const marketNoteParameters = z.object({
  title: z.string().min(1).max(160),
  message: z.string().min(1).max(2_000),
});

const reviewParameters = z.object({
  reason: z.string().min(1).max(2_000),
  ticker: z.string().min(1).max(32).optional(),
});

export function registerInvestmentTools(
  registry: AiToolRegistry,
  dependencies: AiToolDependencies,
): void {
  registry.register({
    name: "create_market_note",
    description: "Registra uma observação educacional sobre a carteira.",
    category: "investment",
    risk: "low",
    parameters: marketNoteParameters,
    cooldownSeconds: 600,
    executor: (args, context) =>
      createInsight(dependencies, context, {
        category: "investment",
        severity: "low",
        title: asString(args.title, "Observação sobre a carteira"),
        message: asString(args.message, "Sua carteira tem um novo ponto de atenção."),
      }),
  });

  registry.register({
    name: "recommend_review",
    description: "Recomenda revisar um ativo ou a carteira (nunca comprar/vender).",
    category: "investment",
    risk: "low",
    parameters: reviewParameters,
    cooldownSeconds: 900,
    executor: (args, context) => {
      const ticker = asOptionalString(args.ticker);
      return createInsight(dependencies, context, {
        category: "investment",
        severity: "medium",
        title: ticker === null ? "Revisar a carteira" : `Revisar ${ticker}`,
        message: asString(
          args.reason,
          "Revise a alocação da carteira com calma.",
        ),
      });
    },
  });
}
