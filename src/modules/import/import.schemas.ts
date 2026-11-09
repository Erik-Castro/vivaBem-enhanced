import { z } from "@hono/zod-openapi";
import { MetaSchema } from "../../http/openapi.ts";

export const ImportUploadSchema = z
  .object({
    accountId: z.string().min(1).openapi({ description: "Conta de destino das transações" }),
    file: z.any().openapi({
      type: "string",
      format: "binary",
      description: "Arquivo CSV ou OFX (até 1 MB)",
    }),
  })
  .openapi("ImportUpload");

export const ImportRowErrorSchema = z
  .object({
    line: z.number().int().nonnegative(),
    message: z.string(),
  })
  .openapi("ImportRowError");

export const ImportPreviewRowSchema = z
  .object({
    line: z.number().int().nonnegative(),
    transactionDate: z.string(),
    type: z.enum(["income", "expense"]),
    amountMinor: z.number().int().positive(),
    description: z.string().nullable(),
    externalId: z.string().nullable(),
    importHash: z.string(),
    duplicate: z.boolean(),
  })
  .openapi("ImportPreviewRow");

export const ImportPreviewResponseSchema = z
  .object({
    data: z.object({
      accountId: z.string(),
      currencyCode: z.string(),
      fileName: z.string().nullable(),
      format: z.enum(["csv", "ofx"]),
      totalRows: z.number().int().nonnegative(),
      validRows: z.number().int().nonnegative(),
      newRows: z.number().int().nonnegative(),
      duplicateRows: z.number().int().nonnegative(),
      rows: z.array(ImportPreviewRowSchema),
      errors: z.array(ImportRowErrorSchema),
    }),
    meta: MetaSchema,
  })
  .openapi("ImportPreviewResponse");

export const ImportCommitResponseSchema = z
  .object({
    data: z.object({
      accountId: z.string(),
      currencyCode: z.string(),
      fileName: z.string().nullable(),
      format: z.enum(["csv", "ofx"]),
      imported: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
      transactionIds: z.array(z.string()),
      errors: z.array(ImportRowErrorSchema),
    }),
    meta: MetaSchema,
  })
  .openapi("ImportCommitResponse");
