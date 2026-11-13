import { z } from "@hono/zod-openapi";
import { MetaSchema } from "../../http/openapi.ts";
import { NOTIFICATION_CATEGORIES, NOTIFICATION_SEVERITIES } from "./notifications.repository.ts";

export const NotificationCategorySchema = z.enum(NOTIFICATION_CATEGORIES);
export const NotificationSeveritySchema = z.enum(NOTIFICATION_SEVERITIES);

export const NotificationSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    message: z.string(),
    category: NotificationCategorySchema,
    severity: NotificationSeveritySchema,
    link: z.string().nullable(),
    isRead: z.boolean(),
    createdAt: z.string(),
  })
  .openapi("Notification");

export const NotificationQuerySchema = z
  .object({
    isRead: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .openapi("NotificationQuery");

export const NotificationIdParamsSchema = z.object({ id: z.string().min(1) });

export const NotificationListResponseSchema = z
  .object({
    data: z.object({ notifications: z.array(NotificationSchema) }),
    meta: MetaSchema.extend({
      limit: z.number().int().positive(),
      offset: z.number().int().nonnegative(),
      hasMore: z.boolean(),
    }),
  })
  .openapi("NotificationListResponse");

export const NotificationResponseSchema = z
  .object({
    data: z.object({ notification: NotificationSchema }),
    meta: MetaSchema,
  })
  .openapi("NotificationResponse");

export const UnreadCountResponseSchema = z
  .object({
    data: z.object({ unread: z.number().int().nonnegative() }),
    meta: MetaSchema,
  })
  .openapi("UnreadCountResponse");

export const MarkAllReadResponseSchema = z
  .object({
    data: z.object({ marked: z.number().int().nonnegative() }),
    meta: MetaSchema,
  })
  .openapi("MarkAllReadResponse");

export const PushKeyResponseSchema = z
  .object({
    data: z.object({
      enabled: z.boolean(),
      /** Ponto não comprimido P-256 em base64url, para `applicationServerKey`. */
      publicKey: z.string().nullable(),
    }),
    meta: MetaSchema,
  })
  .openapi("PushKeyResponse");

export const PushSubscriptionSchema = z
  .object({
    id: z.string(),
    endpoint: z.string(),
    createdAt: z.string(),
    lastSeenAt: z.string(),
  })
  .openapi("PushSubscription");

export const PushSubscriptionBodySchema = z
  .object({
    endpoint: z.string().url().max(2_048),
    keys: z.object({
      p256dh: z.string().min(1).max(255),
      auth: z.string().min(1).max(255),
    }),
  })
  .openapi("PushSubscriptionBody");

export const PushUnsubscribeBodySchema = z
  .object({ endpoint: z.string().url().max(2_048) })
  .openapi("PushUnsubscribeBody");

export const PushSubscriptionListResponseSchema = z
  .object({
    data: z.object({ subscriptions: z.array(PushSubscriptionSchema) }),
    meta: MetaSchema,
  })
  .openapi("PushSubscriptionListResponse");

export const PushSubscriptionResponseSchema = z
  .object({
    data: z.object({ subscription: PushSubscriptionSchema }),
    meta: MetaSchema,
  })
  .openapi("PushSubscriptionResponse");

export const PushUnsubscribeResponseSchema = z
  .object({
    data: z.object({ revoked: z.literal(true) }),
    meta: MetaSchema,
  })
  .openapi("PushUnsubscribeResponse");

export const PushTestResponseSchema = z
  .object({
    data: z.object({ notificationId: z.string() }),
    meta: MetaSchema,
  })
  .openapi("PushTestResponse");
