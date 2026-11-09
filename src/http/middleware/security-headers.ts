import { createMiddleware } from "@hono/hono/factory";
import type { AppEnv } from "../types.ts";
import type { AppConfig } from "../../config.ts";

/** CSP mínima para respostas de API: nada deve ser carregado ou enquadrado. */
const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/**
 * Headers de segurança para a API. O Swagger UI é servido na mesma origem e
 * usa scripts/estilos próprios, então ele fica sem CSP para não quebrar a
 * documentação interativa.
 */
export function securityHeaders(config: AppConfig) {
  return createMiddleware<AppEnv, "*">(async (c, next) => {
    await next();

    const isDocs = c.req.path.startsWith("/api/docs");

    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    c.header("Cross-Origin-Resource-Policy", "same-origin");
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    c.header("X-Permitted-Cross-Domain-Policies", "none");

    if (!isDocs) {
      c.header("Content-Security-Policy", API_CSP);
      // Respostas autenticadas e dados financeiros nunca devem ser cacheados.
      c.header("Cache-Control", "no-store");
    }

    if (config.isProduction) {
      c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  });
}
