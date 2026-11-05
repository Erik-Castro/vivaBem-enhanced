import { z } from "@hono/zod-openapi";
import { MetaSchema } from "../../http/openapi.ts";
import {
  BusinessDateSchema,
  CurrencyCodeSchema,
  PositiveMinorSchema,
  TransactionSchema,
} from "../transactions/transactions.schemas.ts";
import { RECURRING_FREQUENCIES, RECURRING_TYPES } from "./recurring.repository.ts";

export const RecurringFrequencySchema = z.enum(RECURRING_FREQUENCIES);
export const RecurringTypeSchema = z.enum(RECURRING_TYPES);

export const RecurringSchema = z
  .object({
    id: z.string(),
    accountId: z.string(),
    accountName: z.string(),
    categoryId: z.string().nullable(),
    categoryName: z.string().nullable(),
    type: RecurringTypeSchema,
    amountMinor: z.number().int(),
    currencyCode: z.string(),
    description: z.string().nullable(),
    frequency: RecurringFrequencySchema,
    interval: z.number().int(),
    dayOfMonth: z.number().int().nullable(),
    startDate: z.string(),
    endDate: z.string().nullable(),
    nextOccurrence: z.string(),
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("RecurringTransaction");

export const CreateRecurringRequestSchema = z
  .object({
    accountId: z.string().min(1),
    categoryId: z.string().min(1).nullable().optional(),
    type: RecurringTypeSchema,
    amountMinor: PositiveMinorSchema,
    currencyCode: CurrencyCodeSchema.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    frequency: RecurringFrequencySchema,
    interval: z.number().int().min(1).max(60).default(1),
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    startDate: BusinessDateSchema,
    endDate: BusinessDateSchema.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (value) =>
      !((value.frequency === "daily" || value.frequency === "weekly") &&
        value.dayOfMonth !== undefined && value.dayOfMonth !== null),
    {
      message: "`dayOfMonth` só se aplica a recorrências mensais ou anuais",
      path: ["dayOfMonth"],
    },
  )
  .refine(
    (value) =>
      value.endDate === undefined || value.endDate === null ||
      value.endDate >= value.startDate,
    { message: "A data final precisa ser igual ou posterior à data inicial", path: ["endDate"] },
  )
  .openapi("CreateRecurringRequest");

export const UpdateRecurringRequestSchema = z
  .object({
    accountId: z.string().min(1).optional(),
    categoryId: z.string().min(1).nullable().optional(),
    type: RecurringTypeSchema.optional(),
    amountMinor: PositiveMinorSchema.optional(),
    currencyCode: CurrencyCodeSchema.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    frequency: RecurringFrequencySchema.optional(),
    interval: z.number().int().min(1).max(60).optional(),
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    startDate: BusinessDateSchema.optional(),
    endDate: BusinessDateSchema.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "Informe ao menos um campo",
  })
  .openapi("UpdateRecurringRequest");

const queryBoolean = z.preprocess((value) => {
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return value;
}, z.boolean());

export const RecurringQuerySchema = z
  .object({
    includeInactive: queryBoolean.default(false),
  })
  .openapi("RecurringQuery");

export const UpcomingQuerySchema = z
  .object({
    days: z.coerce.number().int().min(1).max(365).default(30),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .openapi("UpcomingQuery");

export const UpcomingOccurrenceSchema = z
  .object({
    recurringId: z.string(),
    accountId: z.string(),
    categoryId: z.string().nullable(),
    type: RecurringTypeSchema,
    amountMinor: z.number().int(),
    currencyCode: z.string(),
    description: z.string().nullable(),
    occurrenceDate: z.string(),
  })
  .openapi("UpcomingOccurrence");

export const RecurringResponseSchema = z
  .object({
    data: z.object({ recurring: RecurringSchema }),
    meta: MetaSchema,
  })
  .openapi("RecurringResponse");

export const RecurringsResponseSchema = z
  .object({
    data: z.object({ recurrings: z.array(RecurringSchema) }),
    meta: MetaSchema,
  })
  .openapi("RecurringsResponse");

export const UpcomingResponseSchema = z
  .object({
    data: z.object({ occurrences: z.array(UpcomingOccurrenceSchema) }),
    meta: MetaSchema,
  })
  .openapi("UpcomingResponse");

export const RunNowResponseSchema = z
  .object({
    data: z.object({
      recurring: RecurringSchema,
      transaction: TransactionSchema,
    }),
    meta: MetaSchema,
  })
  .openapi("RunNowResponse");
