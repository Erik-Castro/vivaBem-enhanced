import { createMiddleware } from "@hono/hono/factory";
import type { AppConfig } from "../../config.ts";
import type { AppDatabase } from "../../db/client.ts";
import { IpBlocklistRepository } from "../../modules/security/ip-blocklist.repository.ts";
import { AppError } from "../errors.ts";
import type { AppEnv } from "../types.ts";
import { clientIp } from "./rate-limit.ts";

/**
 * Rejeita IPs bloqueados pelas tools de segurança antes do rate limit.
 *
 * A consulta é feita só nos endpoints de autenticação: bloquear todas as rotas
 * puniria um usuário legítimo que compartilha IP (NAT, operadora móvel).
 */
export function ipBlocklist(
  db: AppDatabase,
  config: AppConfig,
  repository?: IpBlocklistRepository,
) {
  const blocks = repository ?? new IpBlocklistRepository(db);

  return createMiddleware<AppEnv, "*">(async (c, next) => {
    const ip = clientIp(c, config);
    if (ip !== "unknown" && blocks.isBlocked(ip, new Date().toISOString())) {
      throw new AppError("FORBIDDEN", "Acesso bloqueado temporariamente");
    }
    await next();
  });
}
