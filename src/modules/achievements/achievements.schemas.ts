import { z } from "@hono/zod-openapi";
import { MetaSchema } from "../../http/openapi.ts";
import { ACHIEVEMENT_CATEGORIES } from "./achievements.repository.ts";

export const AchievementCategorySchema = z.enum(ACHIEVEMENT_CATEGORIES);

export const AchievementSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    category: AchievementCategorySchema,
    pointsReward: z.number().int().nonnegative(),
    badgeIconUrl: z.string().nullable(),
    targetMetric: z.number().int().nonnegative(),
    isHidden: z.boolean(),
    createdAt: z.string(),
  })
  .openapi("Achievement");

export const AchievementProgressSchema = AchievementSchema.extend({
  currentProgress: z.number().int().nonnegative(),
  isUnlocked: z.boolean(),
  unlockedAt: z.string().nullable(),
}).openapi("AchievementProgress");

export const AchievementSummarySchema = z
  .object({
    unlocked: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    points: z.number().int().nonnegative(),
  })
  .openapi("AchievementSummary");

export const AchievementsResponseSchema = z
  .object({
    data: z.object({
      summary: AchievementSummarySchema,
      achievements: z.array(AchievementProgressSchema),
    }),
    meta: MetaSchema,
  })
  .openapi("AchievementsResponse");

export const AchievementCatalogResponseSchema = z
  .object({
    data: z.object({ achievements: z.array(AchievementSchema) }),
    meta: MetaSchema,
  })
  .openapi("AchievementCatalogResponse");
