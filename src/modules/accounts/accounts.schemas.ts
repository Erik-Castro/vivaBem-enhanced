import { z } from "@hono/zod-openapi";
import { MetaSchema } from "../../http/openapi.ts";
import { ACCOUNT_TYPES } from "./accounts.repository.ts";
import {
  CurrencyCodeSchema,
  MAX_MINOR,
  PaginationMetaSchema,
  TransactionSchema,
} from "../transactions/transactions.schemas.ts";

export const AccountTypeSchema = z.enum(ACCOUNT_TYPES);

export const CreditCardDetailsSchema = z
  .object({
    closingDay: z.number().int().min(1).max(31),
    dueDay: z.number().int().min(1).max(31),
    limitMinor: z.number().int().min(0).max(MAX_MINOR).default(0),
  })
  .openapi("CreditCardDetails");

export const AccountSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: AccountTypeSchema,
    currencyCode: z.string(),
    isActive: z.boolean(),
    creditCard: CreditCardDetailsSchema.nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Account");

export const CreateAccountRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    type: AccountTypeSchema,
    currencyCode: CurrencyCodeSchema.optional(),
    creditCard: z
      .object({
        closingDay: z.number().int().min(1).max(31),
        dueDay: z.number().int().min(1).max(31),
        limitMinor: z.number().int().min(0).max(MAX_MINOR).default(0),
      })
      .optional(),
  })
  .openapi("CreateAccountRequest");

export const UpdateAccountRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    currencyCode: CurrencyCodeSchema.optional(),
    isActive: z.boolean().optional(),
    creditCard: z
      .object({
        closingDay: z.number().int().min(1).max(31).optional(),
        dueDay: z.number().int().min(1).max(31).optional(),
        limitMinor: z.number().int().min(0).max(MAX_MINOR).optional(),
      })
      .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
        message: "Informe ao menos um campo do cartão",
      })
      .optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "Informe ao menos um campo",
  })
  .openapi("UpdateAccountRequest");

export const AccountQuerySchema = z
  .object({
    includeInactive: z.preprocess((value) => {
      if (value === "true" || value === true) return true;
      if (value === "false" || value === false) return false;
      return value;
    }, z.boolean().default(false)),
  })
  .openapi("AccountQuery");

export const AccountResponseSchema = z
  .object({
    data: z.object({ account: AccountSchema }),
    meta: MetaSchema,
  })
  .openapi("AccountResponse");

export const AccountsResponseSchema = z
  .object({
    data: z.object({ accounts: z.array(AccountSchema) }),
    meta: MetaSchema,
  })
  .openapi("AccountsResponse");

export const AccountBalanceSchema = z
  .object({
    accountId: z.string(),
    currencyCode: z.string(),
    balanceMinor: z.number().int(),
    clearedBalanceMinor: z.number().int(),
    transactionCount: z.number().int().nonnegative(),
    availableCreditMinor: z.number().int().nullable(),
  })
  .openapi("AccountBalance");

export const AccountBalanceResponseSchema = z
  .object({
    data: z.object({ balance: AccountBalanceSchema }),
    meta: MetaSchema,
  })
  .openapi("AccountBalanceResponse");

export const AccountTransactionsResponseSchema = z
  .object({
    data: z.object({ transactions: z.array(TransactionSchema) }),
    meta: PaginationMetaSchema,
  })
  .openapi("AccountTransactionsResponse");
