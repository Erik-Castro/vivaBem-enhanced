import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppConfig } from "../../config.ts";
import { ErrorResponseSchema } from "../../http/openapi.ts";
import type { AppEnv } from "../../http/types.ts";
import type { Goal, GoalContribution } from "./goals.repository.ts";
import type { GoalProgress, GoalsService } from "./goals.service.ts";
import {
  CreateContributionRequestSchema,
  CreateGoalRequestSchema,
  GoalProgressResponseSchema,
  GoalQuerySchema,
  GoalResponseSchema,
  GoalsResponseSchema,
  UpdateGoalRequestSchema,
} from "./goals.schemas.ts";

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
const contributionParamsSchema = z.object({
  id: z.string().min(1),
  contributionId: z.string().min(1),
});

const listGoalsRoute = createRoute({
  method: "get",
  path: "/api/v1/goals",
  tags: ["Goals"],
  summary: "Lista as metas do usuário",
  security,
  request: { query: GoalQuerySchema },
  responses: {
    200: { description: "Metas", content: json(GoalsResponseSchema) },
    ...errorResponses,
  },
});

const createGoalRoute = createRoute({
  method: "post",
  path: "/api/v1/goals",
  tags: ["Goals"],
  summary: "Cria uma meta",
  security,
  request: { body: { content: json(CreateGoalRequestSchema) } },
  responses: {
    201: { description: "Meta criada", content: json(GoalResponseSchema) },
    ...errorResponses,
  },
});

const getGoalRoute = createRoute({
  method: "get",
  path: "/api/v1/goals/{id}",
  tags: ["Goals"],
  summary: "Retorna uma meta",
  security,
  request: { params: idParamsSchema },
  responses: {
    200: { description: "Meta", content: json(GoalResponseSchema) },
    ...errorResponses,
  },
});

const updateGoalRoute = createRoute({
  method: "patch",
  path: "/api/v1/goals/{id}",
  tags: ["Goals"],
  summary: "Atualiza uma meta",
  security,
  request: {
    params: idParamsSchema,
    body: { content: json(UpdateGoalRequestSchema) },
  },
  responses: {
    200: { description: "Meta atualizada", content: json(GoalResponseSchema) },
    ...errorResponses,
  },
});

const deleteGoalRoute = createRoute({
  method: "delete",
  path: "/api/v1/goals/{id}",
  tags: ["Goals"],
  summary: "Cancela uma meta",
  security,
  request: { params: idParamsSchema },
  responses: {
    204: { description: "Meta cancelada" },
    ...errorResponses,
  },
});

const goalProgressRoute = createRoute({
  method: "get",
  path: "/api/v1/goals/{id}/progress",
  tags: ["Goals"],
  summary: "Progresso da meta e contribuições",
  security,
  request: { params: idParamsSchema },
  responses: {
    200: { description: "Progresso da meta", content: json(GoalProgressResponseSchema) },
    ...errorResponses,
  },
});

const addContributionRoute = createRoute({
  method: "post",
  path: "/api/v1/goals/{id}/contributions",
  tags: ["Goals"],
  summary: "Registra uma contribuição",
  security,
  request: {
    params: idParamsSchema,
    body: { content: json(CreateContributionRequestSchema) },
  },
  responses: {
    201: { description: "Contribuição registrada", content: json(GoalProgressResponseSchema) },
    ...errorResponses,
  },
});

const deleteContributionRoute = createRoute({
  method: "delete",
  path: "/api/v1/goals/{id}/contributions/{contributionId}",
  tags: ["Goals"],
  summary: "Remove uma contribuição",
  security,
  request: { params: contributionParamsSchema },
  responses: {
    200: { description: "Contribuição removida", content: json(GoalProgressResponseSchema) },
    ...errorResponses,
  },
});

export interface GoalsControllerDependencies {
  readonly service: GoalsService;
  readonly config: AppConfig;
}

/** Remove `userId` antes de expor a meta na API. */
export function toGoalView(goal: Goal) {
  return {
    id: goal.id,
    targetAccountId: goal.targetAccountId,
    targetAccountName: goal.targetAccountName,
    name: goal.name,
    description: goal.description,
    targetAmountMinor: goal.targetAmountMinor,
    currencyCode: goal.currencyCode,
    targetDate: goal.targetDate,
    status: goal.status,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
  };
}

export function toContributionView(contribution: GoalContribution) {
  return {
    id: contribution.id,
    goalId: contribution.goalId,
    accountId: contribution.accountId,
    accountName: contribution.accountName,
    transactionId: contribution.transactionId,
    amountMinor: contribution.amountMinor,
    contributionDate: contribution.contributionDate,
    note: contribution.note,
    createdAt: contribution.createdAt,
  };
}

export function toGoalProgressView(progress: GoalProgress) {
  return {
    goal: toGoalView(progress.goal),
    contributions: progress.contributions.map(toContributionView),
    contributedMinor: progress.contributedMinor,
    remainingMinor: progress.remainingMinor,
    progressPercent: progress.progressPercent,
    isCompleted: progress.isCompleted,
    contributionCount: progress.contributionCount,
    lastContributionDate: progress.lastContributionDate,
  };
}

export function registerGoalsRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: GoalsControllerDependencies,
): void {
  const { service } = dependencies;

  app.openapi(listGoalsRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const query = c.req.valid("query");
    const goals = service.list(userId, query.status);

    return c.json(
      {
        data: { goals: goals.map(toGoalView) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(createGoalRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const goal = service.create(userId, c.req.valid("json"));

    return c.json(
      {
        data: { goal: toGoalView(goal) },
        meta: { requestId: c.get("requestId") },
      },
      201,
    );
  });

  app.openapi(getGoalRoute, (c) => {
    const goal = service.get(c.get("userId") ?? "", c.req.valid("param").id);

    return c.json(
      {
        data: { goal: toGoalView(goal) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(updateGoalRoute, (c) => {
    const goal = service.update(
      c.get("userId") ?? "",
      c.req.valid("param").id,
      c.req.valid("json"),
    );

    return c.json(
      {
        data: { goal: toGoalView(goal) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(deleteGoalRoute, (c) => {
    service.delete(c.get("userId") ?? "", c.req.valid("param").id);
    return c.body(null, 204);
  });

  app.openapi(goalProgressRoute, (c) => {
    const progress = service.progress(c.get("userId") ?? "", c.req.valid("param").id);

    return c.json(
      {
        data: { progress: toGoalProgressView(progress) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(addContributionRoute, (c) => {
    const progress = service.addContribution(
      c.get("userId") ?? "",
      c.req.valid("param").id,
      c.req.valid("json"),
    );

    return c.json(
      {
        data: { progress: toGoalProgressView(progress) },
        meta: { requestId: c.get("requestId") },
      },
      201,
    );
  });

  app.openapi(deleteContributionRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const params = c.req.valid("param");
    const progress = service.removeContribution(userId, params.id, params.contributionId);

    return c.json(
      {
        data: { progress: toGoalProgressView(progress) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });
}
