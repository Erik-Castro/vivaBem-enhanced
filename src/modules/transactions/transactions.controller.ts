import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppConfig } from "../../config.ts";
import { ErrorResponseSchema } from "../../http/openapi.ts";
import type { AppEnv } from "../../http/types.ts";
import type { TransactionsService } from "./transactions.service.ts";
import {
  CreateTransactionRequestSchema,
  SummaryQuerySchema,
  TransactionQuerySchema,
  TransactionResponseSchema,
  TransactionsListResponseSchema,
  TransactionsResponseSchema,
  TransactionSummaryResponseSchema,
  TransferRequestSchema,
  TransferResponseSchema,
  UpdateTransactionRequestSchema,
} from "./transactions.schemas.ts";

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

const listTransactionsRoute = createRoute({
  method: "get",
  path: "/api/v1/transactions",
  tags: ["Transactions"],
  summary: "Lista as transações do usuário",
  security,
  request: { query: TransactionQuerySchema },
  responses: {
    200: { description: "Transações", content: json(TransactionsListResponseSchema) },
    ...errorResponses,
  },
});

const summaryRoute = createRoute({
  method: "get",
  path: "/api/v1/transactions/summary",
  tags: ["Transactions"],
  summary: "Resumo por moeda e categoria",
  description: "Transferências não entram no resumo; totais são agrupados por moeda.",
  security,
  request: { query: SummaryQuerySchema },
  responses: {
    200: { description: "Resumo", content: json(TransactionSummaryResponseSchema) },
    ...errorResponses,
  },
});

const transferRoute = createRoute({
  method: "post",
  path: "/api/v1/transactions/transfer",
  tags: ["Transactions"],
  summary: "Cria uma transferência entre contas",
  security,
  request: { body: { content: json(TransferRequestSchema) } },
  responses: {
    201: { description: "Transferência criada", content: json(TransferResponseSchema) },
    ...errorResponses,
  },
});

const createTransactionRoute = createRoute({
  method: "post",
  path: "/api/v1/transactions",
  tags: ["Transactions"],
  summary: "Cria uma transação (ou um parcelamento)",
  security,
  request: { body: { content: json(CreateTransactionRequestSchema) } },
  responses: {
    201: { description: "Transação criada", content: json(TransactionsResponseSchema) },
    ...errorResponses,
  },
});

const getTransactionRoute = createRoute({
  method: "get",
  path: "/api/v1/transactions/{id}",
  tags: ["Transactions"],
  summary: "Retorna uma transação",
  security,
  request: { params: idParamsSchema },
  responses: {
    200: { description: "Transação", content: json(TransactionResponseSchema) },
    ...errorResponses,
  },
});

const updateTransactionRoute = createRoute({
  method: "patch",
  path: "/api/v1/transactions/{id}",
  tags: ["Transactions"],
  summary: "Atualiza uma transação",
  security,
  request: {
    params: idParamsSchema,
    body: { content: json(UpdateTransactionRequestSchema) },
  },
  responses: {
    200: { description: "Transação atualizada", content: json(TransactionResponseSchema) },
    ...errorResponses,
  },
});

const clearTransactionRoute = createRoute({
  method: "post",
  path: "/api/v1/transactions/{id}/clear",
  tags: ["Transactions"],
  summary: "Marca a transação como compensada",
  security,
  request: { params: idParamsSchema },
  responses: {
    200: { description: "Transação compensada", content: json(TransactionResponseSchema) },
    ...errorResponses,
  },
});

const deleteTransactionRoute = createRoute({
  method: "delete",
  path: "/api/v1/transactions/{id}",
  tags: ["Transactions"],
  summary: "Remove uma transação",
  description: "Transferências e parcelamentos são removidos por inteiro (soft delete).",
  security,
  request: { params: idParamsSchema },
  responses: {
    204: { description: "Transação removida" },
    ...errorResponses,
  },
});

export interface TransactionsControllerDependencies {
  readonly service: TransactionsService;
  readonly config: AppConfig;
}

export function registerTransactionsRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: TransactionsControllerDependencies,
): void {
  const { service } = dependencies;

  app.openapi(listTransactionsRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const query = c.req.valid("query");
    const result = service.list(userId, query);

    return c.json(
      {
        data: { transactions: result.items },
        meta: {
          requestId: c.get("requestId"),
          limit: query.limit,
          offset: query.offset,
          hasMore: result.hasMore,
        },
      },
      200,
    );
  });

  app.openapi(summaryRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const summary = service.summary(userId, c.req.valid("query"));

    return c.json(
      { data: summary, meta: { requestId: c.get("requestId") } },
      200,
    );
  });

  app.openapi(transferRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const result = service.transfer(userId, c.req.valid("json"));

    return c.json(
      { data: result, meta: { requestId: c.get("requestId") } },
      201,
    );
  });

  app.openapi(createTransactionRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const transactions = service.create(userId, c.req.valid("json"));

    return c.json(
      {
        data: { transactions },
        meta: { requestId: c.get("requestId") },
      },
      201,
    );
  });

  app.openapi(getTransactionRoute, (c) => {
    const transaction = service.get(c.get("userId") ?? "", c.req.valid("param").id);

    return c.json(
      {
        data: { transaction },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(updateTransactionRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const transaction = service.update(userId, c.req.valid("param").id, c.req.valid("json"));

    return c.json(
      {
        data: { transaction },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(clearTransactionRoute, (c) => {
    const transaction = service.clear(c.get("userId") ?? "", c.req.valid("param").id);

    return c.json(
      {
        data: { transaction },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(deleteTransactionRoute, (c) => {
    service.delete(c.get("userId") ?? "", c.req.valid("param").id);
    return c.body(null, 204);
  });
}
