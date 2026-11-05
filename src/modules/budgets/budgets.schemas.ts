import { z } from "@hono/zod-openapi";
import { MetaSchema } from "../../http/openapi.ts";
import {
  BusinessDateSchema,
  CurrencyCodeSchema,
  PositiveMinorSchema,
} from "../transactions/transactions.schemas.ts";
import { BUDGET_PERIOD_TYPES } from "./budgets.repository.ts";

export const BudgetPeriodTypeSchema = z.enum(BUDGET_PERIOD_TYPES);

export const BudgetSchema = z
  .object({
    id: z.string(),
    categoryId: z.string().nullable(),
    categoryName: z.string().nullable(),
    name: z.string(),
    limitMinor: z.number().int(),
    currencyCode: z.string(),
    periodType: BudgetPeriodTypeSchema,
    startDate: z.string(),
    endDate: z.string().nullable(),
    alertThreshold: z.number().int(),
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Budget");

export const CreateBudgetRequestSchema = z
  .object({
    categoryId: z.string().min(1).nullable().optional(),
    name: z.string().trim().min(1).max(120),
    limitMinor: PositiveMinorSchema,
    currencyCode: CurrencyCodeSchema.optional(),
    periodType: BudgetPeriodTypeSchema,
    startDate: BusinessDateSchema,
    endDate: BusinessDateSchema.nullable().optional(),
    alertThreshold: z.number().int().min(1).max(100).default(80),
    isActive: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.periodType !== "custom" || (value.endDate !== undefined &&
        value.endDate !== null),
    { message: "Orçamentos personalizados exigem data final", path: ["endDate"] },
  )
  .refine(
    (value) =>
      value.periodType === "custom" || value.endDate === undefined ||
      value.endDate === null,
    { message: "`endDate` só se aplica a orçamentos personalizados", path: ["endDate"] },
  )
  .refine(
    (value) =>
      value.periodType !== "custom" || value.endDate === undefined ||
      value.endDate === null || value.endDate >= value.startDate,
    { message: "A data final precisa ser igual ou posterior à data inicial", path: ["endDate"] },
  )
  .openapi("CreateBudgetRequest");

export const UpdateBudgetRequestSchema = z
  .object({
    categoryId: z.string().min(1).nullable().optional(),
    name: z.string().trim().min(1).max(120).optional(),
    limitMinor: PositiveMinorSchema.optional(),
    currencyCode: CurrencyCodeSchema.optional(),
    periodType: BudgetPeriodTypeSchema.optional(),
    startDate: BusinessDateSchema.optional(),
    endDate: BusinessDateSchema.nullable().optional(),
    alertThreshold: z.number().int().min(1).max(100).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "Informe ao menos um campo",
  })
  .openapi("UpdateBudgetRequest");

const queryBoolean = z.preprocess((value) => {
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return value;
}, z.boolean());

export const BudgetQuerySchema = z
  .object({
    includeInactive: queryBoolean.default(false),
  })
  .openapi("BudgetQuery");

export const BudgetStatusQuerySchema = z
  .object({
    date: BusinessDateSchema.optional(),
    includeInactive: queryBoolean.default(false),
  })
  .openapi("BudgetStatusQuery");

export const BudgetPeriodSchema = z
  .object({
    from: z.string(),
    to: z.string(),
  })
  .openapi("BudgetPeriod");

export const BudgetStatusSchema = z
  .object({
    budget: BudgetSchema,
    period: BudgetPeriodSchema,
    spentMinor: z.number().int(),
    remainingMinor: z.number().int(),
    percentUsed: z.number(),
    level: z.enum(["ok", "warning", "exceeded"]),
    crossedThresholds: z.array(z.number().int()),
    isPeriodActive: z.boolean(),
  })
  .openapi("BudgetStatus");

export const BudgetResponseSchema = z
  .object({
    data: z.object({ budget: BudgetSchema }),
    meta: MetaSchema,
  })
  .openapi("BudgetResponse");

export const BudgetsResponseSchema = z
  .object({
    data: z.object({ budgets: z.array(BudgetSchema) }),
    meta: MetaSchema,
  })
  .openapi("BudgetsResponse");

export const BudgetStatusResponseSchema = z
  .object({
    data: z.object({ budgets: z.array(BudgetStatusSchema) }),
    meta: MetaSchema,
  })
  .openapi("BudgetStatusResponse");
