import { z } from "@hono/zod-openapi";
import type { RefinementCtx } from "zod";
import { MetaSchema } from "../../http/openapi.ts";
import { BusinessDateSchema, PaginationMetaSchema } from "../transactions/transactions.schemas.ts";
import { HABIT_FREQUENCY_TYPES, HABIT_TYPES } from "./habits.repository.ts";

export const HabitTypeSchema = z.enum(HABIT_TYPES);
export const HabitFrequencyTypeSchema = z.enum(HABIT_FREQUENCY_TYPES);

export const DaysOfWeekSchema = z
  .array(z.number().int().min(1).max(7))
  .max(7)
  .describe("Dias ISO: 1 = segunda … 7 = domingo");

export const HabitSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    color: z.string().nullable(),
    habitType: HabitTypeSchema,
    frequencyType: HabitFrequencyTypeSchema,
    daysOfWeek: z.array(z.number().int()),
    dailyTarget: z.number().int(),
    targetUnit: z.string().nullable(),
    orderIndex: z.number().int(),
    parentHabitId: z.string().nullable(),
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Habit");

export const HabitLogSchema = z
  .object({
    id: z.string(),
    habitId: z.string(),
    logDate: z.string(),
    value: z.number().int(),
    note: z.string().nullable(),
    triggerId: z.string().nullable(),
    replacementUsed: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("HabitLog");

export const HabitTriggerSchema = z
  .object({
    id: z.string(),
    badHabitId: z.string(),
    badHabitName: z.string(),
    replacementHabitId: z.string().nullable(),
    replacementHabitName: z.string().nullable(),
    triggerDescription: z.string(),
    alternativeAction: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("HabitTrigger");

export const HabitStreakSchema = z
  .object({
    habitId: z.string(),
    currentStreak: z.number().int().nonnegative(),
    longestStreak: z.number().int().nonnegative(),
    lastCompletedDate: z.string().nullable(),
    scheduledToday: z.boolean(),
    completedToday: z.boolean(),
  })
  .openapi("HabitStreak");

export const HabitCalendarDaySchema = z
  .object({
    date: z.string(),
    scheduled: z.boolean(),
    completed: z.boolean(),
    status: z.enum(["completed", "missed", "not_scheduled", "pending"]),
    value: z.number().int().nullable(),
    note: z.string().nullable(),
    triggerId: z.string().nullable(),
    replacementUsed: z.boolean(),
  })
  .openapi("HabitCalendarDay");

export const HabitCalendarSchema = z
  .object({
    habitId: z.string(),
    from: z.string(),
    to: z.string(),
    days: z.array(HabitCalendarDaySchema),
  })
  .openapi("HabitCalendar");

export const CreateHabitRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).nullable().optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use uma cor hexadecimal, ex.: #22c55e")
      .nullable()
      .optional(),
    habitType: HabitTypeSchema,
    frequencyType: HabitFrequencyTypeSchema,
    daysOfWeek: DaysOfWeekSchema.optional(),
    dailyTarget: z.number().int().min(1).max(1_000_000).optional(),
    targetUnit: z.string().trim().max(50).nullable().optional(),
    orderIndex: z.number().int().min(0).optional(),
    parentHabitId: z.string().min(1).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    applyScheduleRules(value.frequencyType, value.daysOfWeek ?? [], ctx);
    if (new Set(value.daysOfWeek ?? []).size !== (value.daysOfWeek ?? []).length) {
      ctx.addIssue({
        code: "custom",
        path: ["daysOfWeek"],
        message: "Os dias da semana não podem se repetir",
      });
    }
  })
  .openapi("CreateHabitRequest");

export const UpdateHabitRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use uma cor hexadecimal, ex.: #22c55e")
      .nullable()
      .optional(),
    habitType: HabitTypeSchema.optional(),
    frequencyType: HabitFrequencyTypeSchema.optional(),
    daysOfWeek: DaysOfWeekSchema.optional(),
    dailyTarget: z.number().int().min(1).max(1_000_000).optional(),
    targetUnit: z.string().trim().max(50).nullable().optional(),
    orderIndex: z.number().int().min(0).optional(),
    parentHabitId: z.string().min(1).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const hasField = Object.values(value).some((entry) => entry !== undefined);
    if (!hasField) {
      ctx.addIssue({
        code: "custom",
        message: "Informe ao menos um campo",
      });
    }

    if (value.frequencyType !== undefined) {
      applyScheduleRules(value.frequencyType, value.daysOfWeek ?? [], ctx);
    }
    if (new Set(value.daysOfWeek ?? []).size !== (value.daysOfWeek ?? []).length) {
      ctx.addIssue({
        code: "custom",
        path: ["daysOfWeek"],
        message: "Os dias da semana não podem se repetir",
      });
    }
  })
  .openapi("UpdateHabitRequest");

export const UpsertHabitLogRequestSchema = z
  .object({
    logDate: BusinessDateSchema,
    value: z.number().int().min(0).max(1_000_000).optional(),
    note: z.string().trim().max(500).nullable().optional(),
    triggerId: z.string().min(1).nullable().optional(),
    replacementUsed: z.boolean().optional(),
  })
  .openapi("UpsertHabitLogRequest");

export const ReorderHabitRequestSchema = z
  .object({
    orderIndex: z.number().int().min(0),
  })
  .openapi("ReorderHabitRequest");

export const HabitLogQuerySchema = z
  .object({
    from: BusinessDateSchema.optional(),
    to: BusinessDateSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine(
    (value) => value.from === undefined || value.to === undefined || value.from <= value.to,
    { message: "`from` não pode ser posterior a `to`", path: ["from"] },
  )
  .openapi("HabitLogQuery");

export const HabitCalendarQuerySchema = z
  .object({
    from: BusinessDateSchema.optional(),
    to: BusinessDateSchema.optional(),
    date: BusinessDateSchema.optional(),
  })
  .refine(
    (value) => value.from === undefined || value.to === undefined || value.from <= value.to,
    { message: "`from` não pode ser posterior a `to`", path: ["from"] },
  )
  .openapi("HabitCalendarQuery");

export const HabitStreakQuerySchema = z
  .object({
    date: BusinessDateSchema.optional(),
  })
  .openapi("HabitStreakQuery");

const queryBoolean = z.preprocess((value) => {
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return value;
}, z.boolean().optional());

export const HabitQuerySchema = z
  .object({
    includeInactive: queryBoolean,
    parentId: z.string().min(1).optional(),
    habitType: HabitTypeSchema.optional(),
  })
  .openapi("HabitQuery");

export const CreateHabitTriggerRequestSchema = z
  .object({
    badHabitId: z.string().min(1),
    replacementHabitId: z.string().min(1).nullable().optional(),
    triggerDescription: z.string().trim().min(1).max(500),
    alternativeAction: z.string().trim().max(500).nullable().optional(),
  })
  .openapi("CreateHabitTriggerRequest");

export const UpdateHabitTriggerRequestSchema = z
  .object({
    replacementHabitId: z.string().min(1).nullable().optional(),
    triggerDescription: z.string().trim().min(1).max(500).optional(),
    alternativeAction: z.string().trim().max(500).nullable().optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "Informe ao menos um campo",
  })
  .openapi("UpdateHabitTriggerRequest");

export const HabitResponseSchema = z
  .object({
    data: z.object({ habit: HabitSchema }),
    meta: MetaSchema,
  })
  .openapi("HabitResponse");

export const HabitsResponseSchema = z
  .object({
    data: z.object({ habits: z.array(HabitSchema) }),
    meta: MetaSchema,
  })
  .openapi("HabitsResponse");

export const HabitLogResponseSchema = z
  .object({
    data: z.object({ log: HabitLogSchema }),
    meta: MetaSchema,
  })
  .openapi("HabitLogResponse");

export const HabitLogsResponseSchema = z
  .object({
    data: z.object({ logs: z.array(HabitLogSchema) }),
    meta: PaginationMetaSchema,
  })
  .openapi("HabitLogsResponse");

export const HabitStreakResponseSchema = z
  .object({
    data: z.object({ streak: HabitStreakSchema }),
    meta: MetaSchema,
  })
  .openapi("HabitStreakResponse");

export const HabitCalendarResponseSchema = z
  .object({
    data: z.object({ calendar: HabitCalendarSchema }),
    meta: MetaSchema,
  })
  .openapi("HabitCalendarResponse");

export const HabitTriggerResponseSchema = z
  .object({
    data: z.object({ trigger: HabitTriggerSchema }),
    meta: MetaSchema,
  })
  .openapi("HabitTriggerResponse");

export const HabitTriggersResponseSchema = z
  .object({
    data: z.object({ triggers: z.array(HabitTriggerSchema) }),
    meta: MetaSchema,
  })
  .openapi("HabitTriggersResponse");

type ScheduleContext = RefinementCtx;

function applyScheduleRules(
  frequencyType: (typeof HABIT_FREQUENCY_TYPES)[number],
  daysOfWeek: readonly number[],
  ctx: ScheduleContext,
): void {
  if (frequencyType === "daily" && daysOfWeek.length > 0) {
    ctx.addIssue({
      code: "custom",
      path: ["daysOfWeek"],
      message: "Hábitos diários não usam dias da semana",
    });
  }
  if (frequencyType === "weekly" && daysOfWeek.length !== 1) {
    ctx.addIssue({
      code: "custom",
      path: ["daysOfWeek"],
      message: "Hábitos semanais exigem exatamente um dia",
    });
  }
  if (frequencyType === "custom" && daysOfWeek.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["daysOfWeek"],
      message: "Hábitos personalizados exigem ao menos um dia",
    });
  }
}
