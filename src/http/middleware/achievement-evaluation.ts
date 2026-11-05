import { createMiddleware } from "@hono/hono/factory";
import type { Logger } from "../../shared/logger/index.ts";
import type { AppEnv } from "../types.ts";
import type { AchievementsService } from "../../modules/achievements/achievements.service.ts";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Rotas que nunca alteram o progresso de conquistas. */
const SKIPPED_PREFIXES = ["/api/v1/achievements", "/api/v1/notifications"];

/**
 * Reavalia as conquistas depois de uma mutação autenticada bem-sucedida.
 *
 * A avaliação roda fora da transação da regra de negócio: se falhar, o log
 * registra o erro mas a resposta da mutação (já produzida) não é afetada.
 */
export function evaluateAchievementsAfterMutation(
  service: AchievementsService,
  logger: Logger,
) {
  return createMiddleware<AppEnv, "*">(async (c, next) => {
    await next();

    if (!MUTATING_METHODS.has(c.req.method.toUpperCase())) return;
    if (SKIPPED_PREFIXES.some((prefix) => c.req.path.startsWith(prefix))) return;

    const userId = c.get("userId");
    if (userId === undefined) return;

    const status = c.res.status;
    if (status < 200 || status >= 300) return;

    try {
      service.evaluate(userId);
    } catch (error) {
      logger.error("achievement_evaluation_failed", {
        userId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
