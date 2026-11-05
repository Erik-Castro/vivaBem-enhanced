import { createMiddleware } from "@hono/hono/factory";
import type { AppEnv } from "../types.ts";
import type { AppConfig } from "../../config.ts";

/**
 * Headers de segurança para a API. CSP fica para quando o frontend for servido
 * por esta mesma origem.
 */
export function securityHeaders(config: AppConfig) {
  return createMiddleware<AppEnv, "*">(async (c, next) => {
    await next();

    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    c.header("Cross-Origin-Resource-Policy", "same-origin");

    if (config.isProduction) {
      c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  });
}
