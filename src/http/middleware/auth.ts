import { createMiddleware } from "@hono/hono/factory";
import { getCookie } from "@hono/hono/cookie";
import type { AppConfig } from "../../config.ts";
import { verifyAccessToken } from "../../shared/crypto/jwt.ts";
import type { AuthRepository } from "../../modules/auth/auth.repository.ts";
import { AppError } from "../errors.ts";
import type { AppEnv } from "../types.ts";
import { ACCESS_COOKIE } from "../cookies.ts";

/**
 * Exige access token válido em cookie e confirma que a sessão ainda está ativa.
 * A checagem no banco faz o logout invalidar o access token imediatamente,
 * mesmo antes do `exp`.
 */
export function requireAuth(repository: AuthRepository, config: AppConfig) {
  return createMiddleware<AppEnv, "*">(async (c, next) => {
    const token = getCookie(c, ACCESS_COOKIE);
    if (token === undefined || token === "") {
      throw new AppError("UNAUTHORIZED", "Autenticação necessária");
    }

    const payload = await verifyAccessToken(token, config.jwtSecret);
    if (!payload) {
      throw new AppError("UNAUTHORIZED", "Sessão inválida ou expirada");
    }

    const session = repository.findSessionById(payload.sid);
    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt !== null ||
      session.expiresAt <= new Date().toISOString()
    ) {
      throw new AppError("UNAUTHORIZED", "Sessão inválida ou expirada");
    }

    c.set("userId", payload.sub);
    c.set("sessionId", payload.sid);

    await next();
  });
}
