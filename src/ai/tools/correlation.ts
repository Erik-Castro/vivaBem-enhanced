import { z } from "zod";
import type { AiToolRegistry } from "../ai.registry.ts";
import { type AiToolDependencies, asSeverity, asString, createInsight, notify } from "./deps.ts";

const correlationInsightParameters = z.object({
  title: z.string().min(1).max(160),
  message: z.string().min(1).max(2_000),
  severity: z.enum(["low", "medium", "high", "critical"]).default("low"),
});

const notifyCorrelationParameters = z.object({
  title: z.string().min(1).max(160),
  message: z.string().min(1).max(2_000),
});

export function registerCorrelationTools(
  registry: AiToolRegistry,
  dependencies: AiToolDependencies,
): void {
  registry.register({
    name: "create_correlation_insight",
    description: "Cria um insight cross-domain a partir de um padrão detectado.",
    category: "correlation",
    risk: "low",
    parameters: correlationInsightParameters,
    cooldownSeconds: 900,
    executor: (args, context) =>
      createInsight(dependencies, context, {
        category: "correlation",
        severity: asSeverity(args.severity),
        title: asString(args.title, "Padrão identificado"),
        message: asString(args.message, "Existe um padrão entre seus hábitos e gastos."),
      }),
  });

  registry.register({
    name: "notify_correlation",
    description: "Notifica o usuário sobre um padrão cross-domain relevante.",
    category: "correlation",
    risk: "low",
    parameters: notifyCorrelationParameters,
    cooldownSeconds: 900,
    executor: (args, context) =>
      notify(dependencies, context, {
        category: "system",
        severity: "low",
        title: asString(args.title, "Padrão identificado"),
        message: asString(args.message, "Encontramos um padrão nos seus dados."),
        link: "/insights",
      }),
  });
}
