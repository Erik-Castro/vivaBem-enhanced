import { z } from "@hono/zod-openapi";
import { MetaSchema } from "../../http/openapi.ts";

export const ExportRecordSchema = z.record(z.string(), z.unknown());
export const ExportRecordListSchema = z.array(ExportRecordSchema);

export const ExportQuerySchema = z
  .object({
    format: z.enum(["json", "csv"]).default("json").openapi({
      description: "`json` exporta todos os domínios; `csv` exporta as transações.",
    }),
  })
  .openapi("ExportQuery");

export const ExportBundleSchema = z
  .object({
    exportedAt: z.string(),
    user: ExportRecordSchema,
    credentials: ExportRecordSchema.nullable(),
    preferences: ExportRecordSchema.nullable(),
    sessions: ExportRecordListSchema,
    accounts: ExportRecordListSchema,
    categories: ExportRecordListSchema,
    transactions: ExportRecordListSchema,
    recurringTransactions: ExportRecordListSchema,
    recurringOccurrences: ExportRecordListSchema,
    budgets: ExportRecordListSchema,
    goals: ExportRecordListSchema,
    goalContributions: ExportRecordListSchema,
    habits: ExportRecordListSchema,
    habitTriggers: ExportRecordListSchema,
    habitLogs: ExportRecordListSchema,
    investments: ExportRecordListSchema,
    investmentTransactions: ExportRecordListSchema,
    investmentQuotes: ExportRecordListSchema,
    achievements: ExportRecordListSchema,
    notifications: ExportRecordListSchema,
    insights: ExportRecordListSchema,
    insightFeedback: ExportRecordListSchema,
    familyLinks: ExportRecordListSchema,
  })
  .openapi("ExportBundle");

export const ExportJsonResponseSchema = z
  .object({
    data: ExportBundleSchema,
    meta: MetaSchema,
  })
  .openapi("ExportJsonResponse");
