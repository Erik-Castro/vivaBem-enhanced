import { assert, assertEquals } from "@std/assert";
import { createTestDatabase } from "../helpers/db.ts";
import { ACHIEVEMENT_CATALOG } from "../../src/modules/achievements/achievements.catalog.ts";
import { evaluateCriteria } from "../../src/modules/achievements/achievements.criteria.ts";
import { resolveCriteria } from "../../src/modules/achievements/achievements.rules.ts";

Deno.test("todas as regras do catálogo compilam e avaliam sem erro", async () => {
  const database = await createTestDatabase();
  const now = new Date("2026-11-05T12:00:00.000Z");

  try {
    const rules = new Set<string>();

    for (const entry of ACHIEVEMENT_CATALOG) {
      const spec = resolveCriteria(entry.criteriaRule, {});
      assert(spec !== null, `regra ausente: ${entry.criteriaRule}`);

      const value = evaluateCriteria(spec, {
        db: database.db,
        userId: "usuario-sem-dados",
        now,
      });

      assert(
        Number.isFinite(value) && value >= 0,
        `${entry.title} produziu ${String(value)}`,
      );
      rules.add(entry.criteriaRule);
    }

    assertEquals(rules.size, 106);
  } finally {
    database.cleanup();
  }
});

Deno.test("critério parametrizado por dia da semana avalia sem erro", async () => {
  const database = await createTestDatabase();
  const now = new Date("2026-11-05T12:00:00.000Z");

  try {
    const spec = resolveCriteria("CONSECUTIVE_DAY_OF_WEEK", { weekday: 3 });
    assert(spec !== null);

    const value = evaluateCriteria(spec, {
      db: database.db,
      userId: "usuario-sem-dados",
      now,
    });
    assertEquals(value, 0);
  } finally {
    database.cleanup();
  }
});

Deno.test("rowStreak usa o filtro e a ordem cronológica", async () => {
  const database = await createTestDatabase();
  const now = new Date("2026-11-05T12:00:00.000Z");
  const db = database.db;

  try {
    db.prepare(
      "INSERT INTO user_profiles (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ).run("usuario-row-streak", "Ana", now.toISOString(), now.toISOString());
    db.prepare(
      `INSERT INTO habits (
         id, user_id, name, habit_type, frequency_type, daily_target, order_index,
         created_at, updated_at
       ) VALUES (?, ?, ?, 'good', 'daily', 1, 0, ?, ?)`,
    ).run("habito-1", "usuario-row-streak", "Leitura", now.toISOString(), now.toISOString());

    const logs = [
      { id: "log-1", date: "2026-11-01", value: 0 },
      { id: "log-2", date: "2026-11-02", value: 0 },
      { id: "log-3", date: "2026-11-03", value: 2 },
      { id: "log-4", date: "2026-11-04", value: 1 },
    ];
    for (const log of logs) {
      db.prepare(
        `INSERT INTO habit_logs (id, habit_id, log_date, value, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        log.id,
        "habito-1",
        log.date,
        log.value,
        `${log.date}T12:00:00.000Z`,
        `${log.date}T12:00:00.000Z`,
      );
    }

    const spec = resolveCriteria("MINIMAL_LOG_STREAK", {});
    assert(spec !== null);

    const first = evaluateCriteria(spec, {
      db,
      userId: "usuario-row-streak",
      now,
    });
    assertEquals(first, 1);

    // Ao alinhar o penúltimo log ao filtro, o streak passa a contar dois.
    db.prepare("UPDATE habit_logs SET value = 1 WHERE id = 'log-3'").run();
    const second = evaluateCriteria(spec, {
      db,
      userId: "usuario-row-streak",
      now,
    });
    assertEquals(second, 2);
  } finally {
    database.cleanup();
  }
});
