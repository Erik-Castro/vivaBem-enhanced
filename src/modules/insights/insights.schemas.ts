import { z } from "@hono/zod-openapi";
import { MetaSchema } from "../../http/openapi.ts";
import { FEEDBACK_RATINGS, INSIGHT_CATEGORIES, INSIGHT_SEVERITIES } from "./insights.repository.ts";

export const InsightCategorySchema = z.enum(INSIGHT_CATEGORIES);
export const InsightSeveritySchema = z.enum(INSIGHT_SEVERITIES);
export const FeedbackRatingSchema = z.enum(FEEDBACK_RATINGS);

export const InsightSchema = z
  .object({
    id: z.string(),
    category: InsightCategorySchema,
    severity: InsightSeveritySchema,
    title: z.string(),
    message: z.string(),
    sourceEvent: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    isRead: z.boolean(),
    createdAt: z.string(),
  })
  .openapi("Insight");

export const InsightQuerySchema = z
  .object({
    category: InsightCategorySchema.optional(),
    isRead: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .openapi("InsightQuery");

export const InsightSearchQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(200),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  })
  .openapi("InsightSearchQuery");

export const InsightIdParamsSchema = z.object({ id: z.string().min(1) });

export const FeedbackRequestSchema = z
  .object({
    rating: FeedbackRatingSchema,
    comment: z.string().trim().max(1_000).optional().nullable(),
  })
  .openapi("InsightFeedbackRequest");

export const FeedbackSchema = z
  .object({
    id: z.string(),
    insightId: z.string(),
    rating: FeedbackRatingSchema,
    comment: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("InsightFeedback");

export const InsightListResponseSchema = z
  .object({
    data: z.object({ insights: z.array(InsightSchema) }),
    meta: MetaSchema.extend({
      limit: z.number().int().positive(),
      offset: z.number().int().nonnegative(),
      hasMore: z.boolean(),
    }),
  })
  .openapi("InsightListResponse");

export const InsightResponseSchema = z
  .object({
    data: z.object({ insight: InsightSchema }),
    meta: MetaSchema,
  })
  .openapi("InsightResponse");

export const InsightSearchResponseSchema = z
  .object({
    data: z.object({ insights: z.array(InsightSchema) }),
    meta: MetaSchema.extend({ query: z.string() }),
  })
  .openapi("InsightSearchResponse");

export const InsightFeedbackResponseSchema = z
  .object({
    data: z.object({ feedback: FeedbackSchema }),
    meta: MetaSchema,
  })
  .openapi("InsightFeedbackResponse");

export const InsightUnreadResponseSchema = z
  .object({
    data: z.object({ unread: z.number().int().nonnegative() }),
    meta: MetaSchema,
  })
  .openapi("InsightUnreadResponse");

export const InsightMarkAllReadResponseSchema = z
  .object({
    data: z.object({ marked: z.number().int().nonnegative() }),
    meta: MetaSchema,
  })
  .openapi("InsightMarkAllReadResponse");
