import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppConfig } from "../../config.ts";
import { ErrorResponseSchema } from "../../http/openapi.ts";
import type { AppEnv } from "../../http/types.ts";
import type {
  Investment,
  InvestmentQuote,
  InvestmentTransaction,
} from "./investments.repository.ts";
import type { InvestmentsService } from "./investments.service.ts";
import {
  CreateInvestmentQuoteRequestSchema,
  CreateInvestmentRequestSchema,
  CreateInvestmentTransactionRequestSchema,
  InvestmentPerformanceResponseSchema,
  InvestmentQuerySchema,
  InvestmentQuoteQuerySchema,
  InvestmentQuoteResponseSchema,
  InvestmentQuotesResponseSchema,
  InvestmentResponseSchema,
  InvestmentsResponseSchema,
  InvestmentTransactionQuerySchema,
  InvestmentTransactionResponseSchema,
  InvestmentTransactionsResponseSchema,
  PortfolioResponseSchema,
  UpdateInvestmentRequestSchema,
} from "./investments.schemas.ts";

const json = <Schema extends z.ZodType>(schema: Schema) => ({
  "application/json": { schema },
});

const errorResponses = {
  400: { description: "Dados inválidos", content: json(ErrorResponseSchema) },
  401: { description: "Não autenticado", content: json(ErrorResponseSchema) },
  403: { description: "Origem/CSRF inválido", content: json(ErrorResponseSchema) },
  404: { description: "Não encontrado", content: json(ErrorResponseSchema) },
  409: { description: "Conflito", content: json(ErrorResponseSchema) },
} as const;

const security = [{ cookieAuth: [] }];

const idParamsSchema = z.object({ id: z.string().min(1) });

const listInvestmentsRoute = createRoute({
  method: "get",
  path: "/api/v1/investments",
  tags: ["Investments"],
  summary: "Lista os ativos do usuário",
  security,
  request: { query: InvestmentQuerySchema },
  responses: {
    200: { description: "Ativos", content: json(InvestmentsResponseSchema) },
    ...errorResponses,
  },
});

const createInvestmentRoute = createRoute({
  method: "post",
  path: "/api/v1/investments",
  tags: ["Investments"],
  summary: "Cadastra um ativo",
  security,
  request: { body: { content: json(CreateInvestmentRequestSchema) } },
  responses: {
    201: { description: "Ativo criado", content: json(InvestmentResponseSchema) },
    ...errorResponses,
  },
});

// Registrada antes de `/{id}` para nunca ser capturada como id.
const portfolioRoute = createRoute({
  method: "get",
  path: "/api/v1/investments/portfolio",
  tags: ["Investments"],
  summary: "Carteira consolidada com posições e totais por moeda",
  security,
  responses: {
    200: { description: "Carteira", content: json(PortfolioResponseSchema) },
    ...errorResponses,
  },
});

const getInvestmentRoute = createRoute({
  method: "get",
  path: "/api/v1/investments/{id}",
  tags: ["Investments"],
  summary: "Retorna um ativo",
  security,
  request: { params: idParamsSchema },
  responses: {
    200: { description: "Ativo", content: json(InvestmentResponseSchema) },
    ...errorResponses,
  },
});

const updateInvestmentRoute = createRoute({
  method: "patch",
  path: "/api/v1/investments/{id}",
  tags: ["Investments"],
  summary: "Atualiza um ativo",
  security,
  request: {
    params: idParamsSchema,
    body: { content: json(UpdateInvestmentRequestSchema) },
  },
  responses: {
    200: { description: "Ativo atualizado", content: json(InvestmentResponseSchema) },
    ...errorResponses,
  },
});

const deleteInvestmentRoute = createRoute({
  method: "delete",
  path: "/api/v1/investments/{id}",
  tags: ["Investments"],
  summary: "Remove um ativo (soft delete)",
  security,
  request: { params: idParamsSchema },
  responses: {
    204: { description: "Ativo removido" },
    ...errorResponses,
  },
});

const listTransactionsRoute = createRoute({
  method: "get",
  path: "/api/v1/investments/{id}/transactions",
  tags: ["Investments"],
  summary: "Lista as operações do ativo",
  security,
  request: { params: idParamsSchema, query: InvestmentTransactionQuerySchema },
  responses: {
    200: {
      description: "Operações",
      content: json(InvestmentTransactionsResponseSchema),
    },
    ...errorResponses,
  },
});

const createTransactionRoute = createRoute({
  method: "post",
  path: "/api/v1/investments/{id}/transactions",
  tags: ["Investments"],
  summary: "Registra uma operação do ativo",
  security,
  request: {
    params: idParamsSchema,
    body: { content: json(CreateInvestmentTransactionRequestSchema) },
  },
  responses: {
    201: {
      description: "Operação registrada",
      content: json(InvestmentTransactionResponseSchema),
    },
    ...errorResponses,
  },
});

const performanceRoute = createRoute({
  method: "get",
  path: "/api/v1/investments/{id}/performance",
  tags: ["Investments"],
  summary: "Posição, custo médio e P&L do ativo",
  security,
  request: { params: idParamsSchema },
  responses: {
    200: {
      description: "Performance",
      content: json(InvestmentPerformanceResponseSchema),
    },
    ...errorResponses,
  },
});

const listQuotesRoute = createRoute({
  method: "get",
  path: "/api/v1/investments/{id}/quotes",
  tags: ["Investments"],
  summary: "Lista as cotações do ativo",
  security,
  request: { params: idParamsSchema, query: InvestmentQuoteQuerySchema },
  responses: {
    200: { description: "Cotações", content: json(InvestmentQuotesResponseSchema) },
    ...errorResponses,
  },
});

const createQuoteRoute = createRoute({
  method: "post",
  path: "/api/v1/investments/{id}/quotes",
  tags: ["Investments"],
  summary: "Registra uma cotação do ativo",
  security,
  request: {
    params: idParamsSchema,
    body: { content: json(CreateInvestmentQuoteRequestSchema) },
  },
  responses: {
    201: { description: "Cotação registrada", content: json(InvestmentQuoteResponseSchema) },
    ...errorResponses,
  },
});

export interface InvestmentsControllerDependencies {
  readonly service: InvestmentsService;
  readonly config: AppConfig;
}

export function toInvestmentView(investment: Investment) {
  return {
    id: investment.id,
    ticker: investment.ticker,
    name: investment.name,
    assetClass: investment.assetClass,
    currencyCode: investment.currencyCode,
    createdAt: investment.createdAt,
    updatedAt: investment.updatedAt,
  };
}

export function toTransactionView(transaction: InvestmentTransaction) {
  return {
    id: transaction.id,
    investmentId: transaction.investmentId,
    accountId: transaction.accountId,
    accountName: transaction.accountName,
    operationType: transaction.operationType,
    quantity: transaction.quantity,
    unitPriceMinor: transaction.unitPriceMinor,
    feesMinor: transaction.feesMinor,
    operationDate: transaction.operationDate,
    createdAt: transaction.createdAt,
  };
}

export function toQuoteView(quote: InvestmentQuote) {
  return {
    id: quote.id,
    investmentId: quote.investmentId,
    priceMinor: quote.priceMinor,
    quotedAt: quote.quotedAt,
    source: quote.source,
    createdAt: quote.createdAt,
  };
}

export function registerInvestmentsRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: InvestmentsControllerDependencies,
): void {
  const { service } = dependencies;

  app.openapi(listInvestmentsRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const query = c.req.valid("query");
    const investments = service.list(userId, query.assetClass);

    return c.json(
      {
        data: { investments: investments.map(toInvestmentView) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(createInvestmentRoute, (c) => {
    const investment = service.create(c.get("userId") ?? "", c.req.valid("json"));

    return c.json(
      {
        data: { investment: toInvestmentView(investment) },
        meta: { requestId: c.get("requestId") },
      },
      201,
    );
  });

  app.openapi(portfolioRoute, (c) => {
    const portfolio = service.portfolio(c.get("userId") ?? "");

    return c.json(
      {
        data: {
          positions: portfolio.positions,
          totals: portfolio.totals,
        },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(getInvestmentRoute, (c) => {
    const investment = service.get(c.get("userId") ?? "", c.req.valid("param").id);

    return c.json(
      {
        data: { investment: toInvestmentView(investment) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(updateInvestmentRoute, (c) => {
    const investment = service.update(
      c.get("userId") ?? "",
      c.req.valid("param").id,
      c.req.valid("json"),
    );

    return c.json(
      {
        data: { investment: toInvestmentView(investment) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(deleteInvestmentRoute, (c) => {
    service.delete(c.get("userId") ?? "", c.req.valid("param").id);
    return c.body(null, 204);
  });

  app.openapi(listTransactionsRoute, (c) => {
    const query = c.req.valid("query");
    const page = service.listTransactions(
      c.get("userId") ?? "",
      c.req.valid("param").id,
      query,
    );

    return c.json(
      {
        data: { transactions: page.items.map(toTransactionView) },
        meta: {
          requestId: c.get("requestId"),
          limit: query.limit,
          offset: query.offset,
          hasMore: page.hasMore,
        },
      },
      200,
    );
  });

  app.openapi(createTransactionRoute, (c) => {
    const transaction = service.addTransaction(
      c.get("userId") ?? "",
      c.req.valid("param").id,
      c.req.valid("json"),
    );

    return c.json(
      {
        data: { transaction: toTransactionView(transaction) },
        meta: { requestId: c.get("requestId") },
      },
      201,
    );
  });

  app.openapi(performanceRoute, (c) => {
    const performance = service.position(c.get("userId") ?? "", c.req.valid("param").id);

    return c.json(
      {
        data: { performance },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(listQuotesRoute, (c) => {
    const query = c.req.valid("query");
    const page = service.listQuotes(
      c.get("userId") ?? "",
      c.req.valid("param").id,
      query,
    );

    return c.json(
      {
        data: { quotes: page.items.map(toQuoteView) },
        meta: {
          requestId: c.get("requestId"),
          limit: query.limit,
          offset: query.offset,
          hasMore: page.hasMore,
        },
      },
      200,
    );
  });

  app.openapi(createQuoteRoute, (c) => {
    const quote = service.addQuote(
      c.get("userId") ?? "",
      c.req.valid("param").id,
      c.req.valid("json"),
    );

    return c.json(
      {
        data: { quote: toQuoteView(quote) },
        meta: { requestId: c.get("requestId") },
      },
      201,
    );
  });
}
