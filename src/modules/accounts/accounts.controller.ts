import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppConfig } from "../../config.ts";
import { ErrorResponseSchema } from "../../http/openapi.ts";
import type { AppEnv } from "../../http/types.ts";
import type { Account } from "./accounts.repository.ts";
import type { AccountsService } from "./accounts.service.ts";
import {
  AccountBalanceResponseSchema,
  AccountQuerySchema,
  AccountResponseSchema,
  AccountsResponseSchema,
  AccountTransactionsResponseSchema,
  CreateAccountRequestSchema,
  UpdateAccountRequestSchema,
} from "./accounts.schemas.ts";
import type { TransactionsService } from "../transactions/transactions.service.ts";
import { AccountTransactionQuerySchema } from "../transactions/transactions.schemas.ts";

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

const listAccountsRoute = createRoute({
  method: "get",
  path: "/api/v1/accounts",
  tags: ["Accounts"],
  summary: "Lista as contas do usuário",
  security,
  request: { query: AccountQuerySchema },
  responses: {
    200: { description: "Contas", content: json(AccountsResponseSchema) },
    ...errorResponses,
  },
});

const createAccountRoute = createRoute({
  method: "post",
  path: "/api/v1/accounts",
  tags: ["Accounts"],
  summary: "Cria uma conta",
  security,
  request: { body: { content: json(CreateAccountRequestSchema) } },
  responses: {
    201: { description: "Conta criada", content: json(AccountResponseSchema) },
    ...errorResponses,
  },
});

const getAccountRoute = createRoute({
  method: "get",
  path: "/api/v1/accounts/{id}",
  tags: ["Accounts"],
  summary: "Retorna uma conta",
  security,
  request: { params: idParamsSchema },
  responses: {
    200: { description: "Conta", content: json(AccountResponseSchema) },
    ...errorResponses,
  },
});

const updateAccountRoute = createRoute({
  method: "patch",
  path: "/api/v1/accounts/{id}",
  tags: ["Accounts"],
  summary: "Atualiza uma conta",
  security,
  request: {
    params: idParamsSchema,
    body: { content: json(UpdateAccountRequestSchema) },
  },
  responses: {
    200: { description: "Conta atualizada", content: json(AccountResponseSchema) },
    ...errorResponses,
  },
});

const deleteAccountRoute = createRoute({
  method: "delete",
  path: "/api/v1/accounts/{id}",
  tags: ["Accounts"],
  summary: "Desativa uma conta",
  description: "A conta e seus dados permanecem no banco (soft delete).",
  security,
  request: { params: idParamsSchema },
  responses: {
    204: { description: "Conta desativada" },
    ...errorResponses,
  },
});

const accountBalanceRoute = createRoute({
  method: "get",
  path: "/api/v1/accounts/{id}/balance",
  tags: ["Accounts"],
  summary: "Retorna o saldo da conta",
  security,
  request: { params: idParamsSchema },
  responses: {
    200: { description: "Saldo", content: json(AccountBalanceResponseSchema) },
    ...errorResponses,
  },
});

const accountTransactionsRoute = createRoute({
  method: "get",
  path: "/api/v1/accounts/{id}/transactions",
  tags: ["Accounts"],
  summary: "Lista as transações de uma conta",
  security,
  request: { params: idParamsSchema, query: AccountTransactionQuerySchema },
  responses: {
    200: { description: "Transações", content: json(AccountTransactionsResponseSchema) },
    ...errorResponses,
  },
});

export interface AccountsControllerDependencies {
  readonly service: AccountsService;
  readonly transactions: TransactionsService;
  readonly config: AppConfig;
}

/** Remove `userId` e campos internos antes de expor a conta na API. */
export function toAccountView(account: Account) {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    currencyCode: account.currencyCode,
    isActive: account.isActive,
    creditCard: account.creditCard,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export function registerAccountsRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: AccountsControllerDependencies,
): void {
  const { service, transactions } = dependencies;

  app.openapi(listAccountsRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const query = c.req.valid("query");
    const accounts = service.list(userId, query.includeInactive);

    return c.json(
      {
        data: { accounts: accounts.map(toAccountView) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(createAccountRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const account = service.create(userId, c.req.valid("json"));

    return c.json(
      {
        data: { account: toAccountView(account) },
        meta: { requestId: c.get("requestId") },
      },
      201,
    );
  });

  app.openapi(getAccountRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const account = service.get(userId, c.req.valid("param").id);

    return c.json(
      {
        data: { account: toAccountView(account) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(updateAccountRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const account = service.update(userId, c.req.valid("param").id, c.req.valid("json"));

    return c.json(
      {
        data: { account: toAccountView(account) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(deleteAccountRoute, (c) => {
    service.deactivate(c.get("userId") ?? "", c.req.valid("param").id);
    return c.body(null, 204);
  });

  app.openapi(accountBalanceRoute, (c) => {
    const balance = service.balance(c.get("userId") ?? "", c.req.valid("param").id);

    return c.json(
      {
        data: { balance },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(accountTransactionsRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const accountId = c.req.valid("param").id;
    service.get(userId, accountId);

    const query = c.req.valid("query");
    const result = transactions.list(userId, {
      accountId,
      categoryId: query.categoryId,
      type: query.type,
      from: query.from,
      to: query.to,
      isCleared: query.isCleared,
      limit: query.limit,
      offset: query.offset,
    });

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
}
