import type { AppDatabase } from "../../db/client.ts";

export const ACHIEVEMENT_CATEGORIES = ["finance", "habit", "investment", "system"] as const;

export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number];

export interface Achievement {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: AchievementCategory;
  readonly pointsReward: number;
  readonly badgeIconUrl: string | null;
  readonly criteriaRule: string;
  readonly criteriaParams: string;
  readonly targetMetric: number;
  readonly isHidden: boolean;
  readonly createdAt: string;
}

export interface AchievementProgress extends Achievement {
  readonly currentProgress: number;
  readonly isUnlocked: boolean;
  readonly unlockedAt: string | null;
}

export interface UserAchievement {
  readonly id: string;
  readonly userId: string;
  readonly achievementId: string;
  readonly currentProgress: number;
  readonly isUnlocked: boolean;
  readonly unlockedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SaveProgressRecord {
  readonly id: string;
  readonly userId: string;
  readonly achievementId: string;
  readonly currentProgress: number;
  readonly isUnlocked: boolean;
  readonly unlockedAt: string | null;
  readonly now: string;
}

interface AchievementRow {
  id: string;
  title: string;
  description: string;
  category: AchievementCategory;
  points_reward: number;
  badge_icon_url: string | null;
  criteria_rule: string;
  criteria_params: string;
  target_metric: number;
  is_hidden: number;
  created_at: string;
}

interface AchievementProgressRow extends AchievementRow {
  current_progress: number;
  is_unlocked: number;
  unlocked_at: string | null;
}

interface UserAchievementRow {
  id: string;
  user_id: string;
  achievement_id: string;
  current_progress: number;
  is_unlocked: number;
  unlocked_at: string | null;
  created_at: string;
  updated_at: string;
}

function toAchievement(row: AchievementRow): Achievement {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    pointsReward: row.points_reward,
    badgeIconUrl: row.badge_icon_url,
    criteriaRule: row.criteria_rule,
    criteriaParams: row.criteria_params,
    targetMetric: row.target_metric,
    isHidden: row.is_hidden === 1,
    createdAt: row.created_at,
  };
}

function toProgress(row: AchievementProgressRow): AchievementProgress {
  return {
    ...toAchievement(row),
    currentProgress: row.current_progress,
    isUnlocked: row.is_unlocked === 1,
    unlockedAt: row.unlocked_at,
  };
}

function toUserAchievement(row: UserAchievementRow): UserAchievement {
  return {
    id: row.id,
    userId: row.user_id,
    achievementId: row.achievement_id,
    currentProgress: row.current_progress,
    isUnlocked: row.is_unlocked === 1,
    unlockedAt: row.unlocked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AchievementsRepository {
  readonly #db: AppDatabase;

  constructor(db: AppDatabase) {
    this.#db = db;
  }

  /** Todo o catálogo, inclusive conquistas ocultas. Usado pelo motor. */
  listAll(): Achievement[] {
    const rows = this.#db
      .prepare<[], AchievementRow>(
        "SELECT * FROM achievements ORDER BY category, title",
      )
      .all();
    return rows.map(toAchievement);
  }

  listCatalog(): Achievement[] {
    const rows = this.#db
      .prepare<[], AchievementRow>(
        "SELECT * FROM achievements WHERE is_hidden = 0 ORDER BY category, title",
      )
      .all();
    return rows.map(toAchievement);
  }

  listForUser(
    userId: string,
    options: { readonly onlyUnlocked?: boolean } = {},
  ): AchievementProgress[] {
    const unlockedFilter = options.onlyUnlocked === true ? "ua.is_unlocked = 1" : "1 = 1";
    const rows = this.#db
      .prepare<[string], AchievementProgressRow>(
        `SELECT a.*, COALESCE(ua.current_progress, 0) AS current_progress,
                COALESCE(ua.is_unlocked, 0) AS is_unlocked, ua.unlocked_at
         FROM achievements a
         LEFT JOIN user_achievements ua
           ON ua.achievement_id = a.id AND ua.user_id = ?
         WHERE ${unlockedFilter}
           AND (a.is_hidden = 0 OR ua.is_unlocked = 1)
         ORDER BY ua.is_unlocked DESC, a.points_reward DESC, a.title`,
      )
      .all(userId);
    return rows.map(toProgress);
  }

  findProgress(userId: string, achievementId: string): UserAchievement | null {
    const row = this.#db
      .prepare<[string, string], UserAchievementRow>(
        "SELECT * FROM user_achievements WHERE user_id = ? AND achievement_id = ?",
      )
      .get(userId, achievementId);
    return row === undefined ? null : toUserAchievement(row);
  }

  listProgress(userId: string): UserAchievement[] {
    const rows = this.#db
      .prepare<[string], UserAchievementRow>(
        "SELECT * FROM user_achievements WHERE user_id = ?",
      )
      .all(userId);
    return rows.map(toUserAchievement);
  }

  saveProgress(record: SaveProgressRecord): void {
    this.#db
      .prepare<
        [string, string, string, number, number, string | null, string, string]
      >(
        `INSERT INTO user_achievements (
           id, user_id, achievement_id, current_progress, is_unlocked,
           unlocked_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, achievement_id) DO UPDATE SET
           current_progress = excluded.current_progress,
           is_unlocked = excluded.is_unlocked,
           unlocked_at = COALESCE(user_achievements.unlocked_at, excluded.unlocked_at),
           updated_at = excluded.updated_at`,
      )
      .run(
        record.id,
        record.userId,
        record.achievementId,
        record.currentProgress,
        record.isUnlocked ? 1 : 0,
        record.unlockedAt,
        record.now,
        record.now,
      );
  }

  countUnlocked(userId: string): number {
    const row = this.#db
      .prepare<[string], { count: number }>(
        "SELECT COUNT(*) AS count FROM user_achievements WHERE user_id = ? AND is_unlocked = 1",
      )
      .get(userId);
    return row?.count ?? 0;
  }

  totalPoints(userId: string): number {
    const row = this.#db
      .prepare<[string], { total: number }>(
        `SELECT COALESCE(SUM(a.points_reward), 0) AS total
         FROM user_achievements ua
         JOIN achievements a ON a.id = ua.achievement_id
         WHERE ua.user_id = ? AND ua.is_unlocked = 1`,
      )
      .get(userId);
    return row?.total ?? 0;
  }

  countCatalog(): number {
    const row = this.#db
      .prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM achievements")
      .get();
    return row?.count ?? 0;
  }

  insertCatalogEntry(entry: {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly category: AchievementCategory;
    readonly pointsReward: number;
    readonly badgeIconUrl: string | null;
    readonly criteriaRule: string;
    readonly criteriaParams: string;
    readonly targetMetric: number;
    readonly isHidden: boolean;
    readonly now: string;
  }): boolean {
    const result = this.#db
      .prepare<
        [
          string,
          string,
          string,
          AchievementCategory,
          number,
          string | null,
          string,
          string,
          number,
          number,
          string,
        ]
      >(
        `INSERT INTO achievements (
           id, title, description, category, points_reward, badge_icon_url,
           criteria_rule, criteria_params, target_metric, is_hidden, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (title) DO NOTHING`,
      )
      .run(
        entry.id,
        entry.title,
        entry.description,
        entry.category,
        entry.pointsReward,
        entry.badgeIconUrl,
        entry.criteriaRule,
        entry.criteriaParams,
        entry.targetMetric,
        entry.isHidden ? 1 : 0,
        entry.now,
      );
    return result.changes > 0;
  }
}
