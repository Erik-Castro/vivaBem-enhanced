import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppConfig } from "../../config.ts";
import { ErrorResponseSchema } from "../../http/openapi.ts";
import type { AppEnv } from "../../http/types.ts";
import type { AiInsight } from "./insights.repository.ts";
import type { InsightsService } from "./insights.service.ts";
import {
  FeedbackRequestSchema,
  InsightFeedbackResponseSchema,
  InsightIdParamsSchema,
  InsightListResponseSchema,
  InsightMarkAllReadResponseSchema,
  InsightQuerySchema,
  InsightResponseSchema,
  InsightSearchQuerySchema,
  InsightSearchResponseSchema,
  InsightUnreadResponseSchema,
} from "./insights.schemas.ts";

const json = <Schema extends z.ZodType>(schema: Schema) => ({
  "application/json": { schema },
});

const errorResponses = {
  400: { description: "Dados inválidos", content: json(ErrorResponseSchema) },
  401: { description: "Não autenticado", content: json(ErrorResponseSchema) },
  403: { description: "Origem/CSRF inválido", content: json(ErrorResponseSchema) },
  404: { description: "Não encontrado", content: json(ErrorResponseSchema) },
} as const;

const security = [{ cookieAuth: [] }];

const listRoute = createRoute({
  method: "get",
  path: "/api/v1/insights",
  tags: ["Insights"],
  summary: "Lista os insights gerados pela IA",
  security,
  request: { query: InsightQuerySchema },
  responses: {
    200: { description: "Insights", content: json(InsightListResponseSchema) },
    ...errorResponses,
  },
});

const unreadRoute = createRoute({
  method: "get",
  path: "/api/v1/insights/unread-count",
  tags: ["Insights"],
  summary: "Conta os insights não lidos",
  security,
  responses: {
    200: { description: "Total de não lidos", content: json(InsightUnreadResponseSchema) },
    ...errorResponses,
  },
});

const searchRoute = createRoute({
  method: "get",
  path: "/api/v1/insights/search",
  tags: ["Insights"],
  summary: "Busca insights por similaridade semântica",
  security,
  request: { query: InsightSearchQuerySchema },
  responses: {
    200: { description: "Insights encontrados", content: json(InsightSearchResponseSchema) },
    ...errorResponses,
  },
});

const markReadRoute = createRoute({
  method: "patch",
  path: "/api/v1/insights/{id}/read",
  tags: ["Insights"],
  summary: "Marca um insight como lido",
  security,
  request: { params: InsightIdParamsSchema },
  responses: {
    200: { description: "Insight atualizado", content: json(InsightResponseSchema) },
    ...errorResponses,
  },
});

const markAllReadRoute = createRoute({
  method: "post",
  path: "/api/v1/insights/read-all",
  tags: ["Insights"],
  summary: "Marca todos os insights como lidos",
  security,
  responses: {
    200: {
      description: "Insights atualizados",
      content: json(InsightMarkAllReadResponseSchema),
    },
    ...errorResponses,
  },
});

const feedbackRoute = createRoute({
  method: "post",
  path: "/api/v1/insights/{id}/feedback",
  tags: ["Insights"],
  summary: "Registra feedback sobre um insight",
  security,
  request: {
    params: InsightIdParamsSchema,
    body: { content: json(FeedbackRequestSchema), required: true },
  },
  responses: {
    200: { description: "Feedback registrado", content: json(InsightFeedbackResponseSchema) },
    ...errorResponses,
  },
});

export interface InsightsControllerDependencies {
  readonly service: InsightsService;
  readonly config: AppConfig;
}

export function toInsightView(insight: AiInsight) {
  return {
    id: insight.id,
    category: insight.category,
    severity: insight.severity,
    title: insight.title,
    message: insight.message,
    sourceEvent: insight.sourceEvent,
    confidence: insight.confidence,
    isRead: insight.isRead,
    createdAt: insight.createdAt,
  };
}

export function registerInsightsRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: InsightsControllerDependencies,
): void {
  const { service } = dependencies;

  app.openapi(listRoute, (c) => {
    const query = c.req.valid("query");
    const page = service.list(c.get("userId") ?? "", {
      category: query.category,
      isRead: query.isRead,
      limit: query.limit,
      offset: query.offset,
    });

    return c.json(
      {
        data: { insights: page.items.map(toInsightView) },
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

  app.openapi(unreadRoute, (c) =>
    c.json(
      {
        data: { unread: service.unreadCount(c.get("userId") ?? "") },
        meta: { requestId: c.get("requestId") },
      },
      200,
    ));

  app.openapi(searchRoute, async (c) => {
    const query = c.req.valid("query");
    const insights = await service.search(
      c.get("userId") ?? "",
      query.q,
      query.limit,
    );

    return c.json(
      {
        data: { insights: insights.map(toInsightView) },
        meta: { requestId: c.get("requestId"), query: query.q },
      },
      200,
    );
  });

  app.openapi(markReadRoute, (c) => {
    const insight = service.markRead(c.get("userId") ?? "", c.req.valid("param").id);
    return c.json(
      {
        data: { insight: toInsightView(insight) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(markAllReadRoute, (c) =>
    c.json(
      {
        data: { marked: service.markAllRead(c.get("userId") ?? "") },
        meta: { requestId: c.get("requestId") },
      },
      200,
    ));

  app.openapi(feedbackRoute, (c) => {
    const body = c.req.valid("json");
    const feedback = service.submitFeedback(
      c.get("userId") ?? "",
      c.req.valid("param").id,
      { rating: body.rating, comment: body.comment ?? null },
    );

    return c.json(
      {
        data: {
          feedback: {
            id: feedback.id,
            insightId: feedback.insightId,
            rating: feedback.rating,
            comment: feedback.comment,
            createdAt: feedback.createdAt,
          },
        },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });
}
