import { createMiddleware } from "@hono/hono/factory";
import { getCookie } from "@hono/hono/cookie";
import type { AppConfig } from "../../config.ts";
import { timingSafeEqual } from "../../shared/crypto/tokens.ts";
import { AppError } from "../errors.ts";
import type { AppEnv } from "../types.ts";
import { CSRF_COOKIE, CSRF_HEADER } from "../cookies.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Proteção CSRF em duas camadas:
 * 1. valida `Origin`/`Sec-Fetch-Site` quando presentes;
 * 2. double-submit: cookie `vb_csrf` precisa bater com `X-CSRF-Token`.
 *
 * Requisições de clientes não-browser (curl, testes) passam pela checagem de
 * origem, mas continuam obrigadas ao double-submit.
 */
export function csrfProtection(config: AppConfig) {
  return createMiddleware<AppEnv, "*">(async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) {
      await next();
      return;
    }

    const origin = c.req.header("origin");
    if (origin !== undefined && origin !== config.appOrigin) {
      throw new AppError("FORBIDDEN", "Origem não permitida");
    }

    const fetchSite = c.req.header("sec-fetch-site");
    if (fetchSite === "cross-site") {
      throw new AppError("FORBIDDEN", "Requisição cross-site bloqueada");
    }

    const cookieToken = getCookie(c, CSRF_COOKIE);
    const headerToken = c.req.header(CSRF_HEADER);

    if (
      cookieToken === undefined ||
      headerToken === undefined ||
      cookieToken === "" ||
      !timingSafeEqual(cookieToken, headerToken)
    ) {
      throw new AppError("FORBIDDEN", "Token CSRF inválido ou ausente");
    }

    await next();
  });
}
