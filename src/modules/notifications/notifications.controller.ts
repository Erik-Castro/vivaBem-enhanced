import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppConfig } from "../../config.ts";
import { ErrorResponseSchema } from "../../http/openapi.ts";
import type { AppEnv } from "../../http/types.ts";
import type { Notification } from "./notifications.repository.ts";
import type { NotificationsService } from "./notifications.service.ts";
import {
  MarkAllReadResponseSchema,
  NotificationIdParamsSchema,
  NotificationListResponseSchema,
  NotificationQuerySchema,
  NotificationResponseSchema,
  UnreadCountResponseSchema,
} from "./notifications.schemas.ts";

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
  path: "/api/v1/notifications",
  tags: ["Notifications"],
  summary: "Lista as notificações do usuário",
  security,
  request: { query: NotificationQuerySchema },
  responses: {
    200: { description: "Notificações", content: json(NotificationListResponseSchema) },
    ...errorResponses,
  },
});

const unreadCountRoute = createRoute({
  method: "get",
  path: "/api/v1/notifications/unread-count",
  tags: ["Notifications"],
  summary: "Conta as notificações não lidas",
  security,
  responses: {
    200: { description: "Total de não lidas", content: json(UnreadCountResponseSchema) },
    ...errorResponses,
  },
});

const markReadRoute = createRoute({
  method: "patch",
  path: "/api/v1/notifications/{id}/read",
  tags: ["Notifications"],
  summary: "Marca uma notificação como lida",
  security,
  request: { params: NotificationIdParamsSchema },
  responses: {
    200: { description: "Notificação atualizada", content: json(NotificationResponseSchema) },
    ...errorResponses,
  },
});

const markAllReadRoute = createRoute({
  method: "post",
  path: "/api/v1/notifications/read-all",
  tags: ["Notifications"],
  summary: "Marca todas as notificações como lidas",
  security,
  responses: {
    200: { description: "Notificações atualizadas", content: json(MarkAllReadResponseSchema) },
    ...errorResponses,
  },
});

export interface NotificationsControllerDependencies {
  readonly service: NotificationsService;
  readonly config: AppConfig;
}

export function toNotificationView(notification: Notification) {
  return {
    id: notification.id,
    title: notification.title,
    message: notification.message,
    category: notification.category,
    severity: notification.severity,
    link: notification.link,
    isRead: notification.isRead,
    createdAt: notification.createdAt,
  };
}

export function registerNotificationsRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: NotificationsControllerDependencies,
): void {
  const { service } = dependencies;

  app.openapi(listRoute, (c) => {
    const query = c.req.valid("query");
    const page = service.list(c.get("userId") ?? "", {
      isRead: query.isRead,
      limit: query.limit,
      offset: query.offset,
    });

    return c.json(
      {
        data: { notifications: page.items.map(toNotificationView) },
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

  app.openapi(unreadCountRoute, (c) => {
    return c.json(
      {
        data: { unread: service.unreadCount(c.get("userId") ?? "") },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(markReadRoute, (c) => {
    const notification = service.markRead(
      c.get("userId") ?? "",
      c.req.valid("param").id,
    );
    return c.json(
      {
        data: { notification: toNotificationView(notification) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(markAllReadRoute, (c) => {
    return c.json(
      {
        data: { marked: service.markAllRead(c.get("userId") ?? "") },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });
}
