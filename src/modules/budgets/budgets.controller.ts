import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppConfig } from "../../config.ts";
import { ErrorResponseSchema } from "../../http/openapi.ts";
import type { AppEnv } from "../../http/types.ts";
import type { Budget } from "./budgets.repository.ts";
import type { BudgetsService } from "./budgets.service.ts";
import {
  BudgetQuerySchema,
  BudgetResponseSchema,
  BudgetsResponseSchema,
  BudgetStatusQuerySchema,
  BudgetStatusResponseSchema,
  CreateBudgetRequestSchema,
  UpdateBudgetRequestSchema,
} from "./budgets.schemas.ts";

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

const listBudgetsRoute = createRoute({
  method: "get",
  path: "/api/v1/budgets",
  tags: ["Budgets"],
  summary: "Lista os orçamentos do usuário",
  security,
  request: { query: BudgetQuerySchema },
  responses: {
    200: { description: "Orçamentos", content: json(BudgetsResponseSchema) },
    ...errorResponses,
  },
});

const budgetStatusRoute = createRoute({
  method: "get",
  path: "/api/v1/budgets/status",
  tags: ["Budgets"],
  summary: "Status dos orçamentos no período corrente",
  security,
  request: { query: BudgetStatusQuerySchema },
  responses: {
    200: { description: "Status dos orçamentos", content: json(BudgetStatusResponseSchema) },
    ...errorResponses,
  },
});

const createBudgetRoute = createRoute({
  method: "post",
  path: "/api/v1/budgets",
  tags: ["Budgets"],
  summary: "Cria um orçamento",
  security,
  request: { body: { content: json(CreateBudgetRequestSchema) } },
  responses: {
    201: { description: "Orçamento criado", content: json(BudgetResponseSchema) },
    ...errorResponses,
  },
});

const getBudgetRoute = createRoute({
  method: "get",
  path: "/api/v1/budgets/{id}",
  tags: ["Budgets"],
  summary: "Retorna um orçamento",
  security,
  request: { params: idParamsSchema },
  responses: {
    200: { description: "Orçamento", content: json(BudgetResponseSchema) },
    ...errorResponses,
  },
});

const updateBudgetRoute = createRoute({
  method: "patch",
  path: "/api/v1/budgets/{id}",
  tags: ["Budgets"],
  summary: "Atualiza um orçamento",
  security,
  request: {
    params: idParamsSchema,
    body: { content: json(UpdateBudgetRequestSchema) },
  },
  responses: {
    200: { description: "Orçamento atualizado", content: json(BudgetResponseSchema) },
    ...errorResponses,
  },
});

const deleteBudgetRoute = createRoute({
  method: "delete",
  path: "/api/v1/budgets/{id}",
  tags: ["Budgets"],
  summary: "Desativa um orçamento",
  security,
  request: { params: idParamsSchema },
  responses: {
    204: { description: "Orçamento desativado" },
    ...errorResponses,
  },
});

export interface BudgetsControllerDependencies {
  readonly service: BudgetsService;
  readonly config: AppConfig;
}

/** Remove `userId` antes de expor o orçamento na API. */
export function toBudgetView(budget: Budget) {
  return {
    id: budget.id,
    categoryId: budget.categoryId,
    categoryName: budget.categoryName,
    name: budget.name,
    limitMinor: budget.limitMinor,
    currencyCode: budget.currencyCode,
    periodType: budget.periodType,
    startDate: budget.startDate,
    endDate: budget.endDate,
    alertThreshold: budget.alertThreshold,
    isActive: budget.isActive,
    createdAt: budget.createdAt,
    updatedAt: budget.updatedAt,
  };
}

export function registerBudgetsRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: BudgetsControllerDependencies,
): void {
  const { service } = dependencies;

  app.openapi(listBudgetsRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const query = c.req.valid("query");
    const budgets = service.list(userId, query.includeInactive);

    return c.json(
      {
        data: { budgets: budgets.map(toBudgetView) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(budgetStatusRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const query = c.req.valid("query");
    const statuses = service.status(userId, query.date, query.includeInactive);

    return c.json(
      {
        data: {
          budgets: statuses.map((status) => ({
            budget: toBudgetView(status.budget),
            period: status.period,
            spentMinor: status.spentMinor,
            remainingMinor: status.remainingMinor,
            percentUsed: status.percentUsed,
            level: status.level,
            crossedThresholds: status.crossedThresholds,
            isPeriodActive: status.isPeriodActive,
          })),
        },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(createBudgetRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const budget = service.create(userId, c.req.valid("json"));

    return c.json(
      {
        data: { budget: toBudgetView(budget) },
        meta: { requestId: c.get("requestId") },
      },
      201,
    );
  });

  app.openapi(getBudgetRoute, (c) => {
    const budget = service.get(c.get("userId") ?? "", c.req.valid("param").id);

    return c.json(
      {
        data: { budget: toBudgetView(budget) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(updateBudgetRoute, (c) => {
    const budget = service.update(
      c.get("userId") ?? "",
      c.req.valid("param").id,
      c.req.valid("json"),
    );

    return c.json(
      {
        data: { budget: toBudgetView(budget) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(deleteBudgetRoute, (c) => {
    service.delete(c.get("userId") ?? "", c.req.valid("param").id);
    return c.body(null, 204);
  });
}
