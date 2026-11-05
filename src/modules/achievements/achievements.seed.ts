import type { AppDatabase } from "../../db/client.ts";
import { uuidv7 } from "../../shared/utils/uuid.ts";
import { ACHIEVEMENT_CATALOG, type AchievementSeed } from "./achievements.catalog.ts";
import { AchievementsRepository } from "./achievements.repository.ts";
import type { CriteriaParams } from "./achievements.rules.ts";

/** Mapeia o dia da semana citado no título para o formato de `strftime('%w')`. */
function weekdayFromTitle(title: string): number | undefined {
  if (/segunda/i.test(title)) return 1;
  if (/ter[cç]a/i.test(title)) return 2;
  if (/quarta/i.test(title)) return 3;
  if (/quinta/i.test(title)) return 4;
  if (/sexta/i.test(title)) return 5;
  if (/s[aá]bado/i.test(title)) return 6;
  if (/domingo/i.test(title)) return 0;
  return undefined;
}

function paramsFor(entry: AchievementSeed): CriteriaParams {
  if (entry.criteriaRule !== "CONSECUTIVE_DAY_OF_WEEK") return {};
  const weekday = weekdayFromTitle(entry.title);
  return weekday === undefined ? {} : { weekday };
}

export interface SeedAchievementsResult {
  readonly inserted: number;
  readonly total: number;
}

/**
 * Semeia o catálogo de conquistas de forma idempotente.
 *
 * O título é a chave natural do catálogo: reiniciar o processo não duplica
 * conquistas nem reescreve o progresso dos usuários.
 */
export function seedAchievements(
  db: AppDatabase,
  now: string = new Date().toISOString(),
): SeedAchievementsResult {
  const repository = new AchievementsRepository(db);

  return db.transaction(() => {
    let inserted = 0;
    for (const entry of ACHIEVEMENT_CATALOG) {
      const added = repository.insertCatalogEntry({
        id: uuidv7(),
        title: entry.title,
        description: entry.description,
        category: entry.category,
        pointsReward: entry.pointsReward,
        badgeIconUrl: entry.badgeIconUrl,
        criteriaRule: entry.criteriaRule,
        criteriaParams: JSON.stringify(paramsFor(entry)),
        targetMetric: entry.targetMetric,
        isHidden: entry.isHidden,
        now,
      });
      if (added) inserted++;
    }

    return { inserted, total: repository.countCatalog() };
  });
}
