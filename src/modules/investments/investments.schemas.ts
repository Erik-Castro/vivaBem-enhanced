import { z } from "@hono/zod-openapi";
import type { RefinementCtx } from "zod";
import { MetaSchema } from "../../http/openapi.ts";
import {
  BusinessDateSchema,
  CurrencyCodeSchema,
  MAX_MINOR,
  PaginationMetaSchema,
} from "../transactions/transactions.schemas.ts";
import { INVESTMENT_OPERATION_TYPES } from "./investments.performance.ts";

export const InvestmentOperationTypeSchema = z.enum(INVESTMENT_OPERATION_TYPES);

export const InvestmentSchema = z
  .object({
    id: z.string(),
    ticker: z.string(),
    name: z.string(),
    assetClass: z.string(),
    currencyCode: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Investment");

export const InvestmentTransactionSchema = z
  .object({
    id: z.string(),
    investmentId: z.string(),
    accountId: z.string(),
    accountName: z.string(),
    operationType: InvestmentOperationTypeSchema,
    quantity: z.number(),
    unitPriceMinor: z.number().int(),
    feesMinor: z.number().int(),
    operationDate: z.string(),
    createdAt: z.string(),
  })
  .openapi("InvestmentTransaction");

export const InvestmentQuoteSchema = z
  .object({
    id: z.string(),
    investmentId: z.string(),
    priceMinor: z.number().int(),
    quotedAt: z.string(),
    source: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("InvestmentQuote");

export const InvestmentPositionSchema = z
  .object({
    investmentId: z.string(),
    ticker: z.string(),
    name: z.string(),
    assetClass: z.string(),
    currencyCode: z.string(),
    quantity: z.number(),
    investedMinor: z.number().int(),
    proceedsMinor: z.number().int(),
    costBasisMinor: z.number().int(),
    averageCostMinor: z.number().int(),
    currentPriceMinor: z.number().int().nullable(),
    marketValueMinor: z.number().int().nullable(),
    unrealizedPnlMinor: z.number().int().nullable(),
    realizedPnlMinor: z.number().int(),
    dividendsMinor: z.number().int(),
    feesMinor: z.number().int(),
    totalPnlMinor: z.number().int(),
    returnPercent: z.number(),
    operationCount: z.number().int().nonnegative(),
    firstOperationDate: z.string().nullable(),
    lastOperationDate: z.string().nullable(),
    quoteQuotedAt: z.string().nullable(),
  })
  .openapi("InvestmentPosition");

export const PortfolioTotalSchema = z
  .object({
    currencyCode: z.string(),
    investmentCount: z.number().int().nonnegative(),
    pricedCount: z.number().int().nonnegative(),
    investedMinor: z.number().int(),
    costBasisMinor: z.number().int(),
    marketValueMinor: z.number().int(),
    unrealizedPnlMinor: z.number().int(),
    realizedPnlMinor: z.number().int(),
    dividendsMinor: z.number().int(),
    feesMinor: z.number().int(),
    totalPnlMinor: z.number().int(),
    valuationComplete: z.boolean(),
  })
  .openapi("PortfolioTotal");

const QuantitySchema = z
  .number()
  .positive("A quantidade precisa ser positiva")
  .max(1_000_000_000, "Quantidade acima do limite")
  .finite();

const UnitPriceSchema = z.number().int().min(0).max(MAX_MINOR);
const FeesSchema = z.number().int().min(0).max(MAX_MINOR);

export const CreateInvestmentRequestSchema = z
  .object({
    ticker: z.string().trim().min(1).max(20),
    name: z.string().trim().min(1).max(120),
    assetClass: z.string().trim().min(1).max(40),
    currencyCode: CurrencyCodeSchema.optional(),
  })
  .openapi("CreateInvestmentRequest");

export const UpdateInvestmentRequestSchema = z
  .object({
    ticker: z.string().trim().min(1).max(20).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    assetClass: z.string().trim().min(1).max(40).optional(),
    currencyCode: CurrencyCodeSchema.optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "Informe ao menos um campo",
  })
  .openapi("UpdateInvestmentRequest");

export const CreateInvestmentTransactionRequestSchema = z
  .object({
    accountId: z.string().min(1),
    operationType: InvestmentOperationTypeSchema,
    quantity: QuantitySchema.optional(),
    unitPriceMinor: UnitPriceSchema.optional(),
    feesMinor: FeesSchema.optional(),
    operationDate: BusinessDateSchema,
  })
  .superRefine((value, ctx) => {
    applyOperationRules(value, ctx);
  })
  .openapi("CreateInvestmentTransactionRequest");

const DateTimeSchema = z
  .string()
  .refine(
    (value) => Number.isFinite(Date.parse(value)),
    "Use um timestamp ISO-8601",
  );

export const CreateInvestmentQuoteRequestSchema = z
  .object({
    priceMinor: z.number().int().positive().max(MAX_MINOR),
    quotedAt: DateTimeSchema.optional(),
    source: z.string().trim().max(60).nullable().optional(),
  })
  .openapi("CreateInvestmentQuoteRequest");

export const InvestmentQuerySchema = z
  .object({
    assetClass: z.string().trim().min(1).max(40).optional(),
  })
  .openapi("InvestmentQuery");

export const InvestmentTransactionQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .openapi("InvestmentTransactionQuery");

export const InvestmentQuoteQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .openapi("InvestmentQuoteQuery");

export const InvestmentResponseSchema = z
  .object({
    data: z.object({ investment: InvestmentSchema }),
    meta: MetaSchema,
  })
  .openapi("InvestmentResponse");

export const InvestmentsResponseSchema = z
  .object({
    data: z.object({ investments: z.array(InvestmentSchema) }),
    meta: MetaSchema,
  })
  .openapi("InvestmentsResponse");

export const InvestmentTransactionResponseSchema = z
  .object({
    data: z.object({ transaction: InvestmentTransactionSchema }),
    meta: MetaSchema,
  })
  .openapi("InvestmentTransactionResponse");

export const InvestmentTransactionsResponseSchema = z
  .object({
    data: z.object({ transactions: z.array(InvestmentTransactionSchema) }),
    meta: PaginationMetaSchema,
  })
  .openapi("InvestmentTransactionsResponse");

export const InvestmentPerformanceResponseSchema = z
  .object({
    data: z.object({ performance: InvestmentPositionSchema }),
    meta: MetaSchema,
  })
  .openapi("InvestmentPerformanceResponse");

export const PortfolioResponseSchema = z
  .object({
    data: z.object({
      positions: z.array(InvestmentPositionSchema),
      totals: z.array(PortfolioTotalSchema),
    }),
    meta: MetaSchema,
  })
  .openapi("PortfolioResponse");

export const InvestmentQuoteResponseSchema = z
  .object({
    data: z.object({ quote: InvestmentQuoteSchema }),
    meta: MetaSchema,
  })
  .openapi("InvestmentQuoteResponse");

export const InvestmentQuotesResponseSchema = z
  .object({
    data: z.object({ quotes: z.array(InvestmentQuoteSchema) }),
    meta: PaginationMetaSchema,
  })
  .openapi("InvestmentQuotesResponse");

type OperationRequest = z.infer<typeof CreateInvestmentTransactionRequestSchema>;

function applyOperationRules(value: OperationRequest, ctx: RefinementCtx): void {
  const quantity = value.quantity ?? 1;
  const unitPrice = value.unitPriceMinor ?? 0;
  const fees = value.feesMinor ?? 0;

  switch (value.operationType) {
    case "buy":
    case "sell":
      if (value.quantity === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["quantity"],
          message: "Informe a quantidade da operação",
        });
      }
      if (unitPrice <= 0) {
        ctx.addIssue({
          code: "custom",
          path: ["unitPriceMinor"],
          message: "Informe um preço unitário maior que zero",
        });
      }
      break;

    case "dividend":
      if (value.quantity === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["quantity"],
          message: "Informe a quantidade do dividendo",
        });
      }
      if (unitPrice <= 0) {
        ctx.addIssue({
          code: "custom",
          path: ["unitPriceMinor"],
          message: "Informe o valor por unidade do dividendo",
        });
      }
      break;

    case "fee":
      if (fees <= 0) {
        ctx.addIssue({
          code: "custom",
          path: ["feesMinor"],
          message: "Informe a taxa da operação",
        });
      }
      break;
  }

  if (quantity <= 0) {
    ctx.addIssue({
      code: "custom",
      path: ["quantity"],
      message: "A quantidade precisa ser positiva",
    });
  }
}
