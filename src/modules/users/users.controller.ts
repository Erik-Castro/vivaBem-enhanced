import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppConfig } from "../../config.ts";
import { ErrorResponseSchema } from "../../http/openapi.ts";
import { clearAuthCookies } from "../../http/cookies.ts";
import type { AppEnv } from "../../http/types.ts";
import type { UsersService } from "./users.service.ts";
import {
  MeResponseSchema,
  SessionsResponseSchema,
  UpdateMeRequestSchema,
  UpdatePreferencesRequestSchema,
} from "../auth/auth.schemas.ts";

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

const getMeRoute = createRoute({
  method: "get",
  path: "/api/v1/me",
  tags: ["Users"],
  summary: "Retorna perfil, preferências e estatísticas",
  security,
  responses: {
    200: { description: "Perfil do usuário", content: json(MeResponseSchema) },
    ...errorResponses,
  },
});

const updateMeRoute = createRoute({
  method: "patch",
  path: "/api/v1/me",
  tags: ["Users"],
  summary: "Atualiza nome ou avatar",
  security,
  request: { body: { content: json(UpdateMeRequestSchema) } },
  responses: {
    200: { description: "Perfil atualizado", content: json(MeResponseSchema) },
    ...errorResponses,
  },
});

const updatePreferencesRoute = createRoute({
  method: "patch",
  path: "/api/v1/me/preferences",
  tags: ["Users"],
  summary: "Atualiza preferências regionais",
  security,
  request: { body: { content: json(UpdatePreferencesRequestSchema) } },
  responses: {
    200: { description: "Preferências atualizadas", content: json(MeResponseSchema) },
    ...errorResponses,
  },
});

const listSessionsRoute = createRoute({
  method: "get",
  path: "/api/v1/me/sessions",
  tags: ["Users"],
  summary: "Lista as sessões ativas",
  security,
  responses: {
    200: { description: "Sessões ativas", content: json(SessionsResponseSchema) },
    ...errorResponses,
  },
});

const sessionParamsSchema = z.object({ id: z.string().min(1) });

const revokeSessionRoute = createRoute({
  method: "delete",
  path: "/api/v1/me/sessions/{id}",
  tags: ["Users"],
  summary: "Revoga uma sessão",
  security,
  request: { params: sessionParamsSchema },
  responses: {
    204: { description: "Sessão revogada" },
    ...errorResponses,
  },
});

export interface UsersControllerDependencies {
  readonly service: UsersService;
  readonly config: AppConfig;
}

export function registerUsersRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: UsersControllerDependencies,
): void {
  const { service, config } = dependencies;

  app.openapi(getMeRoute, (c) => {
    const result = service.getMe(c.get("userId") ?? "");
    return c.json(
      { data: result, meta: { requestId: c.get("requestId") } },
      200,
    );
  });

  app.openapi(updateMeRoute, (c) => {
    const result = service.updateMe(c.get("userId") ?? "", c.req.valid("json"));
    return c.json(
      { data: result, meta: { requestId: c.get("requestId") } },
      200,
    );
  });

  app.openapi(updatePreferencesRoute, (c) => {
    const result = service.updatePreferences(c.get("userId") ?? "", c.req.valid("json"));
    return c.json(
      { data: result, meta: { requestId: c.get("requestId") } },
      200,
    );
  });

  app.openapi(listSessionsRoute, (c) => {
    const sessions = service.listSessions(c.get("userId") ?? "", c.get("sessionId") ?? "");
    return c.json(
      { data: { sessions }, meta: { requestId: c.get("requestId") } },
      200,
    );
  });

  app.openapi(revokeSessionRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const sessionId = c.req.valid("param").id;
    service.revokeSession(userId, sessionId);

    if (sessionId === c.get("sessionId")) {
      clearAuthCookies(c, config);
    }

    return c.body(null, 204);
  });
}
