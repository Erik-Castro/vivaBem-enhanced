import { createMiddleware } from "@hono/hono/factory";
import type { Context } from "@hono/hono";
import { AppError } from "../errors.ts";
import type { AppEnv } from "../types.ts";
import type { AppConfig } from "../../config.ts";
import type { SlidingWindowRateLimiter } from "../../shared/utils/rate-limiter.ts";

/** Extrai o IP do cliente. Confie em `X-Forwarded-For` apenas atrás de proxy. */
export function clientIp(c: Context<AppEnv>): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded !== undefined) {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first !== "") return first;
  }
  return c.req.header("x-real-ip") ?? "unknown";
}

export interface RateLimitOptions {
  readonly scope: string;
  readonly max?: number;
}

/**
 * Aplica o limiter por IP. Endpoints de autenticação usam um `scope` próprio,
 * para que o limite rígido não consuma a cota de outras rotas.
 */
export function rateLimit(
  limiter: SlidingWindowRateLimiter,
  config: AppConfig,
  options: RateLimitOptions,
) {
  const max = options.max ?? config.rateLimit.authMax;

  return createMiddleware<AppEnv, "*">(async (c, next) => {
    const key = `${options.scope}:${clientIp(c)}`;
    const result = limiter.consume(key, max, config.rateLimit.windowMs);

    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(result.remaining));

    if (!result.allowed) {
      c.header("Retry-After", String(result.retryAfterSeconds));
      throw new AppError(
        "RATE_LIMITED",
        "Muitas tentativas. Tente novamente em instantes.",
      );
    }

    await next();
  });
}
