import { createMiddleware } from "@hono/hono/factory";
import type { AppEnv } from "../types.ts";

export const requestLogger = createMiddleware<AppEnv, "*">(async (c, next) => {
  const startedAt = performance.now();
  await next();

  const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
  c.get("logger").info("http_request", {
    requestId: c.get("requestId"),
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs,
    userId: c.get("userId"),
  });
});
