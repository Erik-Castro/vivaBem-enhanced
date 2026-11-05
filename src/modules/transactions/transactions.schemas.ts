import { z } from "@hono/zod-openapi";
import { isValidBusinessDate } from "../../shared/utils/date.ts";
import { MetaSchema } from "../../http/openapi.ts";
import { TRANSACTION_TYPES } from "./transactions.repository.ts";

export const MAX_MINOR = Number.MAX_SAFE_INTEGER;

export const CurrencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "Use um código ISO 4217, ex.: BRL");

export const BusinessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato YYYY-MM-DD")
  .refine(isValidBusinessDate, "Data inválida");

export const PositiveMinorSchema = z
  .number()
  .int("Deve ser um inteiro em centavos")
  .positive("Deve ser maior que zero")
  .max(MAX_MINOR, "Valor acima do limite seguro");

export const TransactionTypeSchema = z.enum(TRANSACTION_TYPES);

export const InstallmentSchema = z
  .object({
    installmentNumber: z.number().int().min(1),
    totalInstallments: z.number().int().min(1),
    installmentGroupId: z.string(),
  })
  .openapi("Installment");

export const TransactionSchema = z
  .object({
    id: z.string(),
    accountId: z.string(),
    accountName: z.string(),
    accountType: z.enum(["checking", "savings", "credit_card", "investment", "cash"]),
    categoryId: z.string().nullable(),
    categoryName: z.string().nullable(),
    transferGroupId: z.string().nullable(),
    type: TransactionTypeSchema,
    amountMinor: z.number().int(),
    currencyCode: z.string(),
    description: z.string().nullable(),
    transactionDate: z.string(),
    isCleared: z.boolean(),
    externalId: z.string().nullable(),
    importHash: z.string().nullable(),
    installment: InstallmentSchema.nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Transaction");

export const PaginationMetaSchema = MetaSchema.extend({
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  hasMore: z.boolean(),
}).openapi("PaginationMeta");

export const CreateTransactionRequestSchema = z
  .object({
    accountId: z.string().min(1),
    categoryId: z.string().min(1).nullable().optional(),
    type: z.enum(["income", "expense"]),
    amountMinor: PositiveMinorSchema,
    currencyCode: CurrencyCodeSchema.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    transactionDate: BusinessDateSchema,
    isCleared: z.boolean().optional(),
    installments: z
      .object({
        totalInstallments: z.number().int().min(2).max(48),
      })
      .optional(),
  })
  .openapi("CreateTransactionRequest");

export const UpdateTransactionRequestSchema = z
  .object({
    categoryId: z.string().min(1).nullable().optional(),
    amountMinor: PositiveMinorSchema.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    transactionDate: BusinessDateSchema.optional(),
    isCleared: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "Informe ao menos um campo",
  })
  .openapi("UpdateTransactionRequest");

export const TransferRequestSchema = z
  .object({
    fromAccountId: z.string().min(1),
    toAccountId: z.string().min(1),
    amountMinor: PositiveMinorSchema,
    description: z.string().trim().max(500).nullable().optional(),
    transactionDate: BusinessDateSchema,
    isCleared: z.boolean().optional(),
  })
  .openapi("TransferRequest");

const queryBoolean = z.preprocess((value) => {
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return value;
}, z.boolean().optional());

export const TransactionQuerySchema = z
  .object({
    accountId: z.string().min(1).optional(),
    categoryId: z.string().min(1).optional(),
    type: TransactionTypeSchema.optional(),
    from: BusinessDateSchema.optional(),
    to: BusinessDateSchema.optional(),
    isCleared: queryBoolean,
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine(
    (value) => value.from === undefined || value.to === undefined || value.from <= value.to,
    { message: "`from` não pode ser posterior a `to`", path: ["from"] },
  )
  .openapi("TransactionQuery");

export const AccountTransactionQuerySchema = z
  .object({
    categoryId: z.string().min(1).optional(),
    type: TransactionTypeSchema.optional(),
    from: BusinessDateSchema.optional(),
    to: BusinessDateSchema.optional(),
    isCleared: queryBoolean,
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine(
    (value) => value.from === undefined || value.to === undefined || value.from <= value.to,
    { message: "`from` não pode ser posterior a `to`", path: ["from"] },
  )
  .openapi("AccountTransactionQuery");

export const SummaryQuerySchema = z
  .object({
    accountId: z.string().min(1).optional(),
    categoryId: z.string().min(1).optional(),
    from: BusinessDateSchema.optional(),
    to: BusinessDateSchema.optional(),
  })
  .refine(
    (value) => value.from === undefined || value.to === undefined || value.from <= value.to,
    { message: "`from` não pode ser posterior a `to`", path: ["from"] },
  )
  .openapi("SummaryQuery");

export const TransactionResponseSchema = z
  .object({
    data: z.object({ transaction: TransactionSchema }),
    meta: MetaSchema,
  })
  .openapi("TransactionResponse");

export const TransactionsResponseSchema = z
  .object({
    data: z.object({ transactions: z.array(TransactionSchema) }),
    meta: MetaSchema,
  })
  .openapi("TransactionsResponse");

export const TransactionsListResponseSchema = z
  .object({
    data: z.object({ transactions: z.array(TransactionSchema) }),
    meta: PaginationMetaSchema,
  })
  .openapi("TransactionsListResponse");

export const TransferResponseSchema = z
  .object({
    data: z.object({
      transferGroupId: z.string(),
      from: TransactionSchema,
      to: TransactionSchema,
    }),
    meta: MetaSchema,
  })
  .openapi("TransferResponse");

export const CategorySummarySchema = z
  .object({
    categoryId: z.string().nullable(),
    categoryName: z.string().nullable(),
    type: z.enum(["income", "expense"]),
    amountMinor: z.number().int(),
  })
  .openapi("CategorySummary");

export const CurrencySummarySchema = z
  .object({
    currencyCode: z.string(),
    incomeMinor: z.number().int(),
    expenseMinor: z.number().int(),
    netMinor: z.number().int(),
    byCategory: z.array(CategorySummarySchema),
  })
  .openapi("CurrencySummary");

export const TransactionSummaryResponseSchema = z
  .object({
    data: z.object({
      period: z.object({
        from: z.string().nullable(),
        to: z.string().nullable(),
      }),
      currencies: z.array(CurrencySummarySchema),
    }),
    meta: MetaSchema,
  })
  .openapi("TransactionSummaryResponse");
