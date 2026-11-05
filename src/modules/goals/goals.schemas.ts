import { z } from "@hono/zod-openapi";
import { MetaSchema } from "../../http/openapi.ts";
import {
  BusinessDateSchema,
  CurrencyCodeSchema,
  PositiveMinorSchema,
} from "../transactions/transactions.schemas.ts";
import { GOAL_STATUSES } from "./goals.repository.ts";

export const GoalStatusSchema = z.enum(GOAL_STATUSES);

export const GoalSchema = z
  .object({
    id: z.string(),
    targetAccountId: z.string().nullable(),
    targetAccountName: z.string().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    targetAmountMinor: z.number().int(),
    currencyCode: z.string(),
    targetDate: z.string().nullable(),
    status: GoalStatusSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Goal");

export const GoalContributionSchema = z
  .object({
    id: z.string(),
    goalId: z.string(),
    accountId: z.string().nullable(),
    accountName: z.string().nullable(),
    transactionId: z.string().nullable(),
    amountMinor: z.number().int(),
    contributionDate: z.string(),
    note: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("GoalContribution");

export const CreateGoalRequestSchema = z
  .object({
    targetAccountId: z.string().min(1).nullable().optional(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).nullable().optional(),
    targetAmountMinor: PositiveMinorSchema,
    currencyCode: CurrencyCodeSchema.optional(),
    targetDate: BusinessDateSchema.nullable().optional(),
  })
  .openapi("CreateGoalRequest");

export const UpdateGoalRequestSchema = z
  .object({
    targetAccountId: z.string().min(1).nullable().optional(),
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    targetAmountMinor: PositiveMinorSchema.optional(),
    currencyCode: CurrencyCodeSchema.optional(),
    targetDate: BusinessDateSchema.nullable().optional(),
    status: z.enum(["active", "paused", "cancelled"]).optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "Informe ao menos um campo",
  })
  .openapi("UpdateGoalRequest");

export const CreateContributionRequestSchema = z
  .object({
    accountId: z.string().min(1).nullable().optional(),
    amountMinor: PositiveMinorSchema,
    contributionDate: BusinessDateSchema,
    note: z.string().trim().max(500).nullable().optional(),
  })
  .openapi("CreateContributionRequest");

export const GoalQuerySchema = z
  .object({
    status: GoalStatusSchema.optional(),
  })
  .openapi("GoalQuery");

export const GoalProgressSchema = z
  .object({
    goal: GoalSchema,
    contributions: z.array(GoalContributionSchema),
    contributedMinor: z.number().int(),
    remainingMinor: z.number().int(),
    progressPercent: z.number(),
    isCompleted: z.boolean(),
    contributionCount: z.number().int(),
    lastContributionDate: z.string().nullable(),
  })
  .openapi("GoalProgress");

export const GoalResponseSchema = z
  .object({
    data: z.object({ goal: GoalSchema }),
    meta: MetaSchema,
  })
  .openapi("GoalResponse");

export const GoalsResponseSchema = z
  .object({
    data: z.object({ goals: z.array(GoalSchema) }),
    meta: MetaSchema,
  })
  .openapi("GoalsResponse");

export const GoalProgressResponseSchema = z
  .object({
    data: z.object({ progress: GoalProgressSchema }),
    meta: MetaSchema,
  })
  .openapi("GoalProgressResponse");
