import type { AppDatabase } from "../../db/client.ts";
import type { Logger } from "../../shared/logger/index.ts";
import { uuidv7 } from "../../shared/utils/uuid.ts";
import type { NotificationsRepository } from "../notifications/notifications.repository.ts";
import { evaluateCriteria } from "./achievements.criteria.ts";
import type {
  Achievement,
  AchievementProgress,
  AchievementsRepository,
} from "./achievements.repository.ts";
import { type CriteriaParams, resolveCriteria } from "./achievements.rules.ts";

export interface AchievementsServiceDependencies {
  readonly db: AppDatabase;
  readonly repository: AchievementsRepository;
  readonly notifications: NotificationsRepository;
  readonly logger: Logger;
}

export interface AchievementSummary {
  readonly unlocked: number;
  readonly total: number;
  readonly points: number;
}

export interface AchievementListResult extends AchievementSummary {
  readonly achievements: AchievementProgress[];
}

function parseParams(raw: string): CriteriaParams {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const weekday = (parsed as { readonly weekday?: unknown }).weekday;
    if (typeof weekday === "number" && Number.isInteger(weekday)) return { weekday };
    return {};
  } catch {
    return {};
  }
}

function severityForPoints(points: number): "low" | "medium" | "high" {
  if (points >= 300) return "high";
  if (points >= 100) return "medium";
  return "low";
}

export class AchievementsService {
  readonly #db: AppDatabase;
  readonly #repository: AchievementsRepository;
  readonly #notifications: NotificationsRepository;
  readonly #logger: Logger;

  constructor(dependencies: AchievementsServiceDependencies) {
    this.#db = dependencies.db;
    this.#repository = dependencies.repository;
    this.#notifications = dependencies.notifications;
    this.#logger = dependencies.logger;
  }

  listCatalog(): Achievement[] {
    return this.#repository.listCatalog();
  }

  /** Avalia e devolve apenas as conquistas já desbloqueadas pelo usuário. */
  listMine(userId: string, now?: Date): AchievementListResult {
    this.evaluate(userId, now);
    return this.#result(userId, true);
  }

  /** Avalia e devolve o progresso de todas as conquistas visíveis. */
  listProgress(userId: string, now?: Date): AchievementListResult {
    this.evaluate(userId, now);
    return this.#result(userId, false);
  }

  /**
   * Recalcula o progresso de todas as conquistas.
   *
   * A avaliação é idempotente: uma conquista já desbloqueada não é reavaliada
   * nem gera nova notificação. O laço curto permite que conquistas de meta
   * (`ACHIEVEMENTS_UNLOCKED_COUNT`) reajam a desbloqueios da mesma execução.
   */
  evaluate(userId: string, now: Date = new Date()): AchievementProgress[] {
    const unlocked: AchievementProgress[] = [];
    const unlockedIds = new Set<string>();

    for (let pass = 0; pass < 3; pass++) {
      const newly = this.#evaluatePass(userId, now);
      if (newly.length === 0) break;
      for (const achievement of newly) {
        if (unlockedIds.has(achievement.id)) continue;
        unlockedIds.add(achievement.id);
        unlocked.push({
          ...achievement,
          currentProgress: achievement.targetMetric,
          isUnlocked: true,
          unlockedAt: now.toISOString(),
        });
      }
    }

    return unlocked;
  }

  #evaluatePass(userId: string, now: Date): Achievement[] {
    const catalog = this.#repository.listAll();
    const existing = new Map(
      this.#repository.listProgress(userId).map((entry) => [entry.achievementId, entry]),
    );
    const cache = new Map<string, number>();
    const newlyUnlocked: Achievement[] = [];
    const nowIso = now.toISOString();

    for (const achievement of catalog) {
      const previous = existing.get(achievement.id);
      if (previous?.isUnlocked === true) continue;

      const params = parseParams(achievement.criteriaParams);
      const spec = resolveCriteria(achievement.criteriaRule, params);
      if (spec === null) {
        this.#logger.warn("achievement_rule_unknown", {
          achievementId: achievement.id,
          rule: achievement.criteriaRule,
        });
        continue;
      }

      const cacheKey = `${achievement.criteriaRule}|${achievement.criteriaParams}`;
      let progress = cache.get(cacheKey);
      if (progress === undefined) {
        try {
          progress = evaluateCriteria(spec, { db: this.#db, userId, now });
        } catch (error) {
          this.#logger.error("achievement_evaluation_failed", {
            achievementId: achievement.id,
            rule: achievement.criteriaRule,
            message: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
        cache.set(cacheKey, progress);
      }

      const isUnlocked = progress >= achievement.targetMetric;
      const save = () => {
        this.#repository.saveProgress({
          id: previous?.id ?? uuidv7(),
          userId,
          achievementId: achievement.id,
          currentProgress: progress,
          isUnlocked,
          unlockedAt: isUnlocked ? nowIso : null,
          now: nowIso,
        });
        // Progresso e notificação entram juntos: se a notificação falhar, o
        // desbloqueio não é persistido e a próxima avaliação tenta de novo.
        if (isUnlocked) this.#notifyUnlock(userId, achievement, nowIso);
      };

      if (isUnlocked) {
        this.#db.transaction(save);
      } else {
        save();
      }

      if (isUnlocked) {
        newlyUnlocked.push(achievement);
      }
    }

    return newlyUnlocked;
  }

  #notifyUnlock(userId: string, achievement: Achievement, now: string): void {
    const title = `Conquista desbloqueada: ${achievement.title}`;
    if (this.#notifications.hasByTitle(userId, title)) return;

    this.#notifications.create({
      id: uuidv7(),
      userId,
      title,
      message: achievement.description,
      category: achievement.category,
      severity: severityForPoints(achievement.pointsReward),
      link: "/achievements",
      now,
    });
  }

  #result(userId: string, onlyUnlocked: boolean): AchievementListResult {
    const achievements = this.#repository.listForUser(userId, { onlyUnlocked });
    return {
      unlocked: this.#repository.countUnlocked(userId),
      total: this.#repository.countCatalog(),
      points: this.#repository.totalPoints(userId),
      achievements,
    };
  }
}
