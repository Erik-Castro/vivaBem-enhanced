import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppConfig } from "../../config.ts";
import { ErrorResponseSchema } from "../../http/openapi.ts";
import type { AppEnv } from "../../http/types.ts";
import type { NotificationsPushService } from "./notifications.push.service.ts";
import {
  PushKeyResponseSchema,
  PushSubscriptionBodySchema,
  PushSubscriptionListResponseSchema,
  PushSubscriptionResponseSchema,
  PushTestResponseSchema,
  PushUnsubscribeBodySchema,
  PushUnsubscribeResponseSchema,
} from "./notifications.schemas.ts";

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

const keyRoute = createRoute({
  method: "get",
  path: "/api/v1/notifications/push/key",
  tags: ["Notifications"],
  summary: "Chave pública VAPID para assinar push",
  security,
  responses: {
    200: { description: "Configuração de push", content: json(PushKeyResponseSchema) },
    ...errorResponses,
  },
});

const listSubscriptionsRoute = createRoute({
  method: "get",
  path: "/api/v1/notifications/push/subscriptions",
  tags: ["Notifications"],
  summary: "Lista os dispositivos inscritos",
  security,
  responses: {
    200: {
      description: "Dispositivos inscritos",
      content: json(PushSubscriptionListResponseSchema),
    },
    ...errorResponses,
  },
});

const subscribeRoute = createRoute({
  method: "post",
  path: "/api/v1/notifications/push/subscriptions",
  tags: ["Notifications"],
  summary: "Inscreve um dispositivo para notificações push",
  security,
  request: { body: { content: json(PushSubscriptionBodySchema) } },
  responses: {
    201: {
      description: "Dispositivo inscrito",
      content: json(PushSubscriptionResponseSchema),
    },
    ...errorResponses,
  },
});

const unsubscribeRoute = createRoute({
  method: "delete",
  path: "/api/v1/notifications/push/subscriptions",
  tags: ["Notifications"],
  summary: "Remove a inscrição de um dispositivo",
  security,
  request: { body: { content: json(PushUnsubscribeBodySchema) } },
  responses: {
    200: {
      description: "Inscrição removida",
      content: json(PushUnsubscribeResponseSchema),
    },
    ...errorResponses,
  },
});

const testRoute = createRoute({
  method: "post",
  path: "/api/v1/notifications/push/test",
  tags: ["Notifications"],
  summary: "Enfileira uma notificação de teste",
  description: "A notificação é criada na fila normal e entregue pelo worker.",
  security,
  responses: {
    202: {
      description: "Notificação enfileirada",
      content: json(PushTestResponseSchema),
    },
    ...errorResponses,
    503: { description: "Push desabilitado", content: json(ErrorResponseSchema) },
  },
});

export interface NotificationsPushControllerDependencies {
  readonly service: NotificationsPushService;
  readonly config: AppConfig;
}

export function registerNotificationsPushRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: NotificationsPushControllerDependencies,
): void {
  const { service } = dependencies;

  app.openapi(keyRoute, (c) => {
    return c.json(
      {
        data: service.key(),
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(listSubscriptionsRoute, (c) => {
    return c.json(
      {
        data: {
          subscriptions: service.list(c.get("userId") ?? "").map(toSubscriptionView),
        },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(subscribeRoute, (c) => {
    const body = c.req.valid("json");
    const subscription = service.subscribe(c.get("userId") ?? "", {
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent: c.req.header("user-agent") ?? null,
    });

    return c.json(
      {
        data: { subscription },
        meta: { requestId: c.get("requestId") },
      },
      201,
    );
  });

  app.openapi(unsubscribeRoute, (c) => {
    service.unsubscribe(c.get("userId") ?? "", c.req.valid("json").endpoint);
    return c.json(
      {
        data: { revoked: true as const },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(testRoute, (c) => {
    const notificationId = service.sendTest(c.get("userId") ?? "");
    return c.json(
      {
        data: { notificationId },
        meta: { requestId: c.get("requestId") },
      },
      202,
    );
  });
}

function toSubscriptionView(subscription: {
  readonly id: string;
  readonly endpoint: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
}) {
  return {
    id: subscription.id,
    endpoint: subscription.endpoint,
    createdAt: subscription.createdAt,
    lastSeenAt: subscription.lastSeenAt,
  };
}
