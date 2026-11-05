import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppConfig } from "../../config.ts";
import { ErrorResponseSchema } from "../../http/openapi.ts";
import type { AppEnv } from "../../http/types.ts";
import type { RecurringTransaction } from "./recurring.repository.ts";
import type { RecurringService } from "./recurring.service.ts";
import {
  CreateRecurringRequestSchema,
  RecurringQuerySchema,
  RecurringResponseSchema,
  RecurringsResponseSchema,
  RunNowResponseSchema,
  UpcomingQuerySchema,
  UpcomingResponseSchema,
  UpdateRecurringRequestSchema,
} from "./recurring.schemas.ts";

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

const listRecurringRoute = createRoute({
  method: "get",
  path: "/api/v1/recurring",
  tags: ["Recurring"],
  summary: "Lista as recorrências do usuário",
  security,
  request: { query: RecurringQuerySchema },
  responses: {
    200: { description: "Recorrências", content: json(RecurringsResponseSchema) },
    ...errorResponses,
  },
});

const upcomingRoute = createRoute({
  method: "get",
  path: "/api/v1/recurring/upcoming",
  tags: ["Recurring"],
  summary: "Próximas ocorrências previstas",
  security,
  request: { query: UpcomingQuerySchema },
  responses: {
    200: { description: "Ocorrências previstas", content: json(UpcomingResponseSchema) },
    ...errorResponses,
  },
});

const createRecurringRoute = createRoute({
  method: "post",
  path: "/api/v1/recurring",
  tags: ["Recurring"],
  summary: "Cria uma recorrência",
  security,
  request: { body: { content: json(CreateRecurringRequestSchema) } },
  responses: {
    201: { description: "Recorrência criada", content: json(RecurringResponseSchema) },
    ...errorResponses,
  },
});

const getRecurringRoute = createRoute({
  method: "get",
  path: "/api/v1/recurring/{id}",
  tags: ["Recurring"],
  summary: "Retorna uma recorrência",
  security,
  request: { params: idParamsSchema },
  responses: {
    200: { description: "Recorrência", content: json(RecurringResponseSchema) },
    ...errorResponses,
  },
});

const updateRecurringRoute = createRoute({
  method: "patch",
  path: "/api/v1/recurring/{id}",
  tags: ["Recurring"],
  summary: "Atualiza uma recorrência",
  security,
  request: {
    params: idParamsSchema,
    body: { content: json(UpdateRecurringRequestSchema) },
  },
  responses: {
    200: { description: "Recorrência atualizada", content: json(RecurringResponseSchema) },
    ...errorResponses,
  },
});

const deleteRecurringRoute = createRoute({
  method: "delete",
  path: "/api/v1/recurring/{id}",
  tags: ["Recurring"],
  summary: "Desativa uma recorrência",
  security,
  request: { params: idParamsSchema },
  responses: {
    204: { description: "Recorrência desativada" },
    ...errorResponses,
  },
});

const runNowRoute = createRoute({
  method: "post",
  path: "/api/v1/recurring/{id}/run-now",
  tags: ["Recurring"],
  summary: "Materializa a próxima ocorrência agora",
  description: "Cria a transação da próxima ocorrência pendente e avança o agendamento.",
  security,
  request: { params: idParamsSchema },
  responses: {
    200: { description: "Ocorrência materializada", content: json(RunNowResponseSchema) },
    ...errorResponses,
  },
});

export interface RecurringControllerDependencies {
  readonly service: RecurringService;
  readonly config: AppConfig;
}

/** Remove `userId` antes de expor a recorrência na API. */
export function toRecurringView(recurring: RecurringTransaction) {
  return {
    id: recurring.id,
    accountId: recurring.accountId,
    accountName: recurring.accountName,
    categoryId: recurring.categoryId,
    categoryName: recurring.categoryName,
    type: recurring.type,
    amountMinor: recurring.amountMinor,
    currencyCode: recurring.currencyCode,
    description: recurring.description,
    frequency: recurring.frequency,
    interval: recurring.interval,
    dayOfMonth: recurring.dayOfMonth,
    startDate: recurring.startDate,
    endDate: recurring.endDate,
    nextOccurrence: recurring.nextOccurrence,
    isActive: recurring.isActive,
    createdAt: recurring.createdAt,
    updatedAt: recurring.updatedAt,
  };
}

export function registerRecurringRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: RecurringControllerDependencies,
): void {
  const { service } = dependencies;

  app.openapi(listRecurringRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const query = c.req.valid("query");
    const recurrings = service.list(userId, query.includeInactive);

    return c.json(
      {
        data: { recurrings: recurrings.map(toRecurringView) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(upcomingRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const query = c.req.valid("query");

    return c.json(
      {
        data: { occurrences: service.upcoming(userId, query.days, query.limit) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(createRecurringRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const recurring = service.create(userId, c.req.valid("json"));

    return c.json(
      {
        data: { recurring: toRecurringView(recurring) },
        meta: { requestId: c.get("requestId") },
      },
      201,
    );
  });

  app.openapi(getRecurringRoute, (c) => {
    const recurring = service.get(c.get("userId") ?? "", c.req.valid("param").id);

    return c.json(
      {
        data: { recurring: toRecurringView(recurring) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(updateRecurringRoute, (c) => {
    const recurring = service.update(
      c.get("userId") ?? "",
      c.req.valid("param").id,
      c.req.valid("json"),
    );

    return c.json(
      {
        data: { recurring: toRecurringView(recurring) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(deleteRecurringRoute, (c) => {
    service.delete(c.get("userId") ?? "", c.req.valid("param").id);
    return c.body(null, 204);
  });

  app.openapi(runNowRoute, (c) => {
    const result = service.runNow(c.get("userId") ?? "", c.req.valid("param").id);

    return c.json(
      {
        data: {
          recurring: toRecurringView(result.recurring),
          transaction: result.transaction,
        },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });
}
