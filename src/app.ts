import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "@hono/hono/cors";
import type { AppConfig } from "./config.ts";
import type { AppDatabase } from "./db/client.ts";
import type { Logger } from "./shared/logger/index.ts";
import { AppError } from "./http/errors.ts";
import { toErrorResponse } from "./http/error-handler.ts";
import type { AppEnv } from "./http/types.ts";
import { healthRoute, readyRoute, registerOpenApiDocument } from "./http/openapi.ts";
import { requestId } from "./http/middleware/request-id.ts";
import { requestLogger } from "./http/middleware/request-logger.ts";
import { bodyLimit } from "./http/middleware/body-limit.ts";
import { securityHeaders } from "./http/middleware/security-headers.ts";
import { API_VERSION, APP_VERSION } from "./version.ts";

export interface AppDependencies {
  readonly db: AppDatabase;
  readonly config: AppConfig;
  readonly logger: Logger;
}

/**
 * Cria a aplicação Hono sem efeitos colaterais de I/O.
 *
 * O banco, a configuração e o logger são injetados — os testes montam a app
 * com um banco temporário em vez de usar um singleton global.
 */
export function createApp({ db, config, logger }: AppDependencies) {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) {
        throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
          details: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
      }
    },
  });

  const startedAt = Date.now();

  app.use("*", requestId);
  app.use("*", async (c, next) => {
    c.set("logger", logger.child({ requestId: c.get("requestId") }));
    await next();
  });
  app.use("*", securityHeaders(config));
  app.use(
    "*",
    cors({
      origin: config.appOrigin,
      credentials: true,
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "X-CSRF-Token", "X-Request-Id"],
      exposeHeaders: ["X-Request-Id"],
      maxAge: 600,
    }),
  );
  app.use("*", bodyLimit());
  app.use("*", requestLogger);

  app.openapi(healthRoute, (c) =>
    c.json(
      {
        data: {
          status: "ok" as const,
          version: APP_VERSION,
          uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        },
        meta: { requestId: c.get("requestId") },
      },
      200,
    ));

  app.openapi(readyRoute, (c) => {
    let migrations = 0;
    let databaseOk = true;

    try {
      db.prepare("SELECT 1 AS ok").get();
      migrations = db
        .prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM schema_migrations")
        .get()?.count ?? 0;
    } catch {
      databaseOk = false;
    }

    const ready = databaseOk;
    const body = {
      data: {
        status: ready ? ("ready" as const) : ("not_ready" as const),
        checks: {
          database: databaseOk ? ("ok" as const) : ("error" as const),
          migrations,
        },
      },
      meta: { requestId: c.get("requestId") },
    };

    return c.json(body, ready ? 200 : 503);
  });

  registerOpenApiDocument(app, config);

  app.get("/api/docs", swaggerUI({ url: `/api/${API_VERSION}/openapi.json` }));

  app.notFound((c) => toErrorResponse(new AppError("NOT_FOUND", "Rota não encontrada"), c));
  app.onError((error, c) => toErrorResponse(error, c));

  return app;
}
