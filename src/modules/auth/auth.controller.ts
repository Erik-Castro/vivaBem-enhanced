import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppConfig } from "../../config.ts";
import { ErrorResponseSchema } from "../../http/openapi.ts";
import { clientIp } from "../../http/middleware/rate-limit.ts";
import {
  clearAuthCookies,
  getRefreshToken,
  setAuthCookies,
  setCsrfCookie,
} from "../../http/cookies.ts";
import type { AppEnv } from "../../http/types.ts";
import { toUserView } from "../users/users.service.ts";
import type { AuthService, RequestContext } from "./auth.service.ts";
import {
  AuthResponseSchema,
  CsrfResponseSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
} from "./auth.schemas.ts";

const json = <Schema extends z.ZodType>(schema: Schema) => ({
  "application/json": { schema },
});

const errorResponses = {
  400: { description: "Dados inválidos", content: json(ErrorResponseSchema) },
  401: { description: "Não autenticado", content: json(ErrorResponseSchema) },
  403: { description: "Origem/CSRF inválido", content: json(ErrorResponseSchema) },
  409: { description: "Conflito", content: json(ErrorResponseSchema) },
  429: { description: "Muitas tentativas", content: json(ErrorResponseSchema) },
} as const;

const csrfRoute = createRoute({
  method: "get",
  path: "/api/v1/auth/csrf",
  tags: ["Auth"],
  summary: "Emite o cookie e o token CSRF",
  description: "O frontend deve chamar este endpoint antes de qualquer requisição mutável e " +
    "reenviar o token no header `X-CSRF-Token`.",
  responses: {
    200: {
      description: "Token CSRF emitido",
      content: json(CsrfResponseSchema),
    },
  },
});

const registerRoute = createRoute({
  method: "post",
  path: "/api/v1/auth/register",
  tags: ["Auth"],
  summary: "Cria uma conta e inicia uma sessão",
  request: { body: { content: json(RegisterRequestSchema) } },
  responses: {
    201: {
      description: "Conta criada",
      content: json(AuthResponseSchema),
    },
    ...errorResponses,
  },
});

const loginRoute = createRoute({
  method: "post",
  path: "/api/v1/auth/login",
  tags: ["Auth"],
  summary: "Autentica com e-mail e senha",
  request: { body: { content: json(LoginRequestSchema) } },
  responses: {
    200: {
      description: "Autenticado",
      content: json(AuthResponseSchema),
    },
    ...errorResponses,
  },
});

const refreshRoute = createRoute({
  method: "post",
  path: "/api/v1/auth/refresh",
  tags: ["Auth"],
  summary: "Rotaciona a sessão usando o refresh token",
  description: "O refresh token é de uso único. Reutilizar um token já rotacionado revoga " +
    "a família inteira de sessões.",
  responses: {
    200: {
      description: "Sessão rotacionada",
      content: json(AuthResponseSchema),
    },
    ...errorResponses,
  },
});

const logoutRoute = createRoute({
  method: "post",
  path: "/api/v1/auth/logout",
  tags: ["Auth"],
  summary: "Encerra a sessão atual",
  responses: {
    204: { description: "Sessão encerrada" },
    ...errorResponses,
  },
});

export interface AuthControllerDependencies {
  readonly service: AuthService;
  readonly config: AppConfig;
}

export function registerAuthRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: AuthControllerDependencies,
): void {
  const { service, config } = dependencies;

  app.openapi(csrfRoute, (c) => {
    const csrfToken = service.createCsrfToken();
    setCsrfCookie(c, config, csrfToken);

    return c.json(
      {
        data: { csrfToken },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(registerRoute, async (c) => {
    const result = await service.register(c.req.valid("json"), requestContext(c));
    setAuthCookies(c, config, result);

    return c.json(
      {
        data: {
          user: toUserView(
            result.user,
            result.credentials.email,
            result.credentials.emailVerified,
            result.preferences,
          ),
          csrfToken: result.csrfToken,
        },
        meta: { requestId: c.get("requestId") },
      },
      201,
    );
  });

  app.openapi(loginRoute, async (c) => {
    const result = await service.login(c.req.valid("json"), requestContext(c));
    setAuthCookies(c, config, result);

    return c.json(
      {
        data: {
          user: toUserView(
            result.user,
            result.credentials.email,
            result.credentials.emailVerified,
            result.preferences,
          ),
          csrfToken: result.csrfToken,
        },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(refreshRoute, async (c) => {
    const result = await service.refresh(getRefreshToken(c), requestContext(c));
    setAuthCookies(c, config, result);

    return c.json(
      {
        data: {
          user: toUserView(
            result.user,
            result.credentials.email,
            result.credentials.emailVerified,
            result.preferences,
          ),
          csrfToken: result.csrfToken,
        },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(logoutRoute, async (c) => {
    await service.logout(getRefreshToken(c), c.get("sessionId"), requestContext(c));
    clearAuthCookies(c, config);
    return c.body(null, 204);
  });
}

function requestContext(c: Parameters<typeof clientIp>[0]): RequestContext {
  return {
    ipAddress: clientIp(c),
    userAgent: c.req.header("user-agent") ?? null,
  };
}
