import { z } from "zod";
import type { AiToolRegistry } from "../ai.registry.ts";
import { type AiToolDependencies, asString, createInsight } from "./deps.ts";

const habitSuggestionParameters = z.object({
  habitId: z.string().optional(),
  habitName: z.string().min(1).max(120),
  suggestion: z.string().min(1).max(2_000),
});

const recommendGoalParameters = z.object({
  habitId: z.string().optional(),
  habitName: z.string().min(1).max(120),
  currentStreak: z.number().int().nonnegative().optional(),
  suggestedTarget: z.union([z.number(), z.string()]).optional(),
  reason: z.string().min(1).max(2_000),
});

const motivationParameters = z.object({
  title: z.string().min(1).max(160),
  message: z.string().min(1).max(2_000),
});

export function registerHabitTools(
  registry: AiToolRegistry,
  dependencies: AiToolDependencies,
): void {
  registry.register({
    name: "create_habit_suggestion",
    description: "Sugere um ajuste prático para um hábito.",
    category: "habit",
    risk: "low",
    parameters: habitSuggestionParameters,
    cooldownSeconds: 600,
    executor: (args, context) => {
      const habitName = asString(args.habitName, "hábito");
      return createInsight(dependencies, context, {
        category: "habit",
        severity: "low",
        title: `Sugestão para ${habitName}`,
        message: asString(args.suggestion, "Tente ajustar a rotina deste hábito."),
      });
    },
  });

  registry.register({
    name: "recommend_goal",
    description: "Sugere uma meta baseada na sequência atual do hábito.",
    category: "habit",
    risk: "low",
    parameters: recommendGoalParameters,
    cooldownSeconds: 900,
    executor: (args, context) => {
      const habitName = asString(args.habitName, "hábito");
      const streak = typeof args.currentStreak === "number" ? args.currentStreak : 0;
      const target = args.suggestedTarget === undefined
        ? "o próximo marco"
        : String(args.suggestedTarget);

      return createInsight(dependencies, context, {
        category: "habit",
        severity: "medium",
        title: `Meta sugerida: ${habitName}`,
        message: `${asString(args.reason, "Você está perto de um novo marco.")} ` +
          `Sequência atual: ${streak}. Meta sugerida: ${target}.`,
      });
    },
  });

  registry.register({
    name: "create_motivation",
    description: "Registra uma mensagem de motivação por um marco atingido.",
    category: "habit",
    risk: "low",
    parameters: motivationParameters,
    cooldownSeconds: 900,
    executor: (args, context) =>
      createInsight(dependencies, context, {
        category: "habit",
        severity: "low",
        title: asString(args.title, "Marco de hábito atingido"),
        message: asString(args.message, "Continue assim!"),
      }),
  });
}
