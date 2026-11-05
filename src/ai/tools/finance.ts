import { z } from "zod";
import type { AiToolRegistry } from "../ai.registry.ts";
import {
  type AiToolDependencies,
  asOptionalString,
  asSeverity,
  asString,
  createInsight,
  notify,
} from "./deps.ts";

const notifyUserParameters = z.object({
  title: z.string().min(1).max(160),
  message: z.string().min(1).max(2_000),
});

const budgetAttentionParameters = z.object({
  budgetId: z.string().optional(),
  percentage: z.number().min(0).max(1_000).optional(),
  title: z.string().min(1).max(160),
  message: z.string().min(1).max(2_000),
});

const suggestCategoryParameters = z.object({
  transactionId: z.string().optional(),
  suggestedCategory: z.string().min(1).max(120),
  title: z.string().min(1).max(160).optional(),
  reason: z.string().min(1).max(2_000),
});

const financialInsightParameters = z.object({
  title: z.string().min(1).max(160),
  message: z.string().min(1).max(2_000),
  severity: z.enum(["low", "medium", "high", "critical"]).default("low"),
});

export function registerFinanceTools(
  registry: AiToolRegistry,
  dependencies: AiToolDependencies,
): void {
  registry.register({
    name: "notify_user",
    description: "Envia uma notificação financeira acionável ao usuário.",
    category: "finance",
    risk: "low",
    parameters: notifyUserParameters,
    cooldownSeconds: 300,
    executor: (args, context) =>
      notify(dependencies, context, {
        category: "finance",
        severity: "low",
        title: asString(args.title, "Alerta financeiro"),
        message: asString(args.message, "Verifique suas finanças"),
        link: "/finances",
      }),
  });

  registry.register({
    name: "flag_budget_attention",
    description: "Sinaliza um orçamento próximo do limite ou estourado.",
    category: "finance",
    risk: "low",
    parameters: budgetAttentionParameters,
    cooldownSeconds: 300,
    executor: (args, context) => {
      const budgetId = asOptionalString(args.budgetId);
      return notify(dependencies, context, {
        category: "finance",
        severity: "medium",
        title: asString(args.title, "Orçamento precisa de atenção"),
        message: asString(args.message, "Um orçamento atingiu o limite configurado"),
        link: budgetId === null ? "/budgets" : `/budgets/${budgetId}`,
      });
    },
  });

  registry.register({
    name: "suggest_category",
    description: "Sugere uma categoria para uma transação sem classificação.",
    category: "finance",
    risk: "low",
    parameters: suggestCategoryParameters,
    cooldownSeconds: 600,
    executor: (args, context) => {
      const suggested = asString(args.suggestedCategory, "Outros");
      return createInsight(dependencies, context, {
        category: "recommendation",
        severity: "low",
        title: asString(args.title, `Sugestão de categoria: ${suggested}`),
        message: asString(
          args.reason,
          `A transação pode ser classificada como ${suggested}.`,
        ),
      });
    },
  });

  registry.register({
    name: "create_financial_insight",
    description: "Registra um insight financeiro com números já calculados.",
    category: "finance",
    risk: "low",
    parameters: financialInsightParameters,
    cooldownSeconds: 300,
    executor: (args, context) =>
      createInsight(dependencies, context, {
        category: "finance",
        severity: asSeverity(args.severity),
        title: asString(args.title, "Insight financeiro"),
        message: asString(args.message, "Análise financeira disponível"),
      }),
  });
}
