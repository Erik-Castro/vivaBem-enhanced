import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppConfig } from "../../config.ts";
import { ErrorResponseSchema } from "../../http/openapi.ts";
import type { AppEnv } from "../../http/types.ts";
import type { Achievement, AchievementProgress } from "./achievements.repository.ts";
import type { AchievementListResult, AchievementsService } from "./achievements.service.ts";
import {
  AchievementCatalogResponseSchema,
  AchievementsResponseSchema,
} from "./achievements.schemas.ts";

const json = <Schema extends z.ZodType>(schema: Schema) => ({
  "application/json": { schema },
});

const errorResponses = {
  401: { description: "Não autenticado", content: json(ErrorResponseSchema) },
  403: { description: "Origem/CSRF inválido", content: json(ErrorResponseSchema) },
} as const;

const security = [{ cookieAuth: [] }];

const listCatalogRoute = createRoute({
  method: "get",
  path: "/api/v1/achievements",
  tags: ["Achievements"],
  summary: "Lista o catálogo público de conquistas",
  security,
  responses: {
    200: { description: "Catálogo de conquistas", content: json(AchievementCatalogResponseSchema) },
    ...errorResponses,
  },
});

const listMineRoute = createRoute({
  method: "get",
  path: "/api/v1/achievements/me",
  tags: ["Achievements"],
  summary: "Lista as conquistas desbloqueadas do usuário",
  security,
  responses: {
    200: { description: "Conquistas desbloqueadas", content: json(AchievementsResponseSchema) },
    ...errorResponses,
  },
});

const listProgressRoute = createRoute({
  method: "get",
  path: "/api/v1/achievements/me/progress",
  tags: ["Achievements"],
  summary: "Progresso de todas as conquistas visíveis",
  security,
  responses: {
    200: { description: "Progresso das conquistas", content: json(AchievementsResponseSchema) },
    ...errorResponses,
  },
});

export interface AchievementsControllerDependencies {
  readonly service: AchievementsService;
  readonly config: AppConfig;
}

/** Remove o nome interno da regra e os parâmetros da resposta pública. */
export function toAchievementView(achievement: Achievement) {
  return {
    id: achievement.id,
    title: achievement.title,
    description: achievement.description,
    category: achievement.category,
    pointsReward: achievement.pointsReward,
    badgeIconUrl: achievement.badgeIconUrl,
    targetMetric: achievement.targetMetric,
    isHidden: achievement.isHidden,
    createdAt: achievement.createdAt,
  };
}

function toProgressView(achievement: AchievementProgress) {
  return {
    ...toAchievementView(achievement),
    currentProgress: achievement.currentProgress,
    isUnlocked: achievement.isUnlocked,
    unlockedAt: achievement.unlockedAt,
  };
}

function toListPayload(result: AchievementListResult) {
  return {
    summary: {
      unlocked: result.unlocked,
      total: result.total,
      points: result.points,
    },
    achievements: result.achievements.map(toProgressView),
  };
}

export function registerAchievementsRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: AchievementsControllerDependencies,
): void {
  const { service } = dependencies;

  app.openapi(listCatalogRoute, (c) => {
    const achievements = service.listCatalog().map(toAchievementView);
    return c.json(
      {
        data: { achievements },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(listMineRoute, (c) => {
    const result = service.listMine(c.get("userId") ?? "");
    return c.json(
      { data: toListPayload(result), meta: { requestId: c.get("requestId") } },
      200,
    );
  });

  app.openapi(listProgressRoute, (c) => {
    const result = service.listProgress(c.get("userId") ?? "");
    return c.json(
      { data: toListPayload(result), meta: { requestId: c.get("requestId") } },
      200,
    );
  });
}
