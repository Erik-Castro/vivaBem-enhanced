import { assertEquals, assertExists, assertThrows } from "@std/assert";
import {
  assertSchemaCurrent,
  inspectSchema,
  loadMigrations,
  migrate,
  MigrationError,
} from "../../src/db/migrate.ts";
import { createTestDatabase } from "../helpers/db.ts";

Deno.test("loadMigrations carrega as migrações em ordem", async () => {
  const migrations = await loadMigrations();

  assertEquals(migrations.length >= 1, true);
  assertEquals(migrations[0]?.name, "001_core.sql");
  assertEquals(migrations[0]?.version, 1);
  assertEquals(migrations[0]?.checksum.length, 64);
  assertEquals(migrations[1]?.name, "002_finance.sql");
  assertEquals(migrations[1]?.version, 2);
});

Deno.test("migrate aplica uma vez e é idempotente", async () => {
  const testDb = await createTestDatabase({ migrate: false });

  try {
    const migrations = await loadMigrations();

    const first = migrate(testDb.db, migrations);
    assertEquals(first.applied.length, migrations.length);

    const second = migrate(testDb.db, migrations);
    assertEquals(second.applied.length, 0);

    const row = testDb.db
      .prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM schema_migrations")
      .get();
    assertEquals(row?.count, migrations.length);
  } finally {
    testDb.cleanup();
  }
});

Deno.test("migrate cria as tabelas de identidade", async () => {
  const testDb = await createTestDatabase();

  try {
    const rows = testDb.db
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all();

    const tables = new Set(rows.map((row) => row.name));
    for (
      const table of [
        "user_profiles",
        "user_credentials",
        "user_preferences",
        "user_sessions",
        "auth_events",
      ]
    ) {
      assertEquals(tables.has(table), true, `tabela ausente: ${table}`);
    }
  } finally {
    testDb.cleanup();
  }
});

Deno.test("migrate cria as tabelas de hábitos", async () => {
  const testDb = await createTestDatabase();

  try {
    const rows = testDb.db
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all();

    const tables = new Set(rows.map((row) => row.name));
    for (const table of ["habits", "habit_logs", "habit_triggers"]) {
      assertEquals(tables.has(table), true, `tabela ausente: ${table}`);
    }
  } finally {
    testDb.cleanup();
  }
});

Deno.test("migrate cria as tabelas de investimentos", async () => {
  const testDb = await createTestDatabase();

  try {
    const rows = testDb.db
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all();

    const tables = new Set(rows.map((row) => row.name));
    for (const table of ["investments", "investment_transactions", "investment_quotes"]) {
      assertEquals(tables.has(table), true, `tabela ausente: ${table}`);
    }
  } finally {
    testDb.cleanup();
  }
});

Deno.test("migrate detecta checksum divergente", async () => {
  const testDb = await createTestDatabase({ migrate: false });

  try {
    const migrations = await loadMigrations();
    migrate(testDb.db, migrations);

    const tampered = migrations.map((migration, index) =>
      index === 0 ? { ...migration, checksum: "0".repeat(64) } : migration
    );

    assertThrows(() => migrate(testDb.db, tampered), MigrationError);
  } finally {
    testDb.cleanup();
  }
});

Deno.test("migrate detecta migração aplicada sem arquivo", async () => {
  const testDb = await createTestDatabase({ migrate: false });

  try {
    const migrations = await loadMigrations();
    migrate(testDb.db, migrations);

    const removed = migrations.filter((migration) => migration.version !== 1);
    assertThrows(() => migrate(testDb.db, removed), MigrationError);
  } finally {
    testDb.cleanup();
  }
});

Deno.test("assertSchemaCurrent aceita banco migrado", async () => {
  const testDb = await createTestDatabase();

  try {
    const migrations = await loadMigrations();
    assertSchemaCurrent(testDb.db, migrations);
  } finally {
    testDb.cleanup();
  }
});

Deno.test("assertSchemaCurrent recusa banco não migrado", async () => {
  const testDb = await createTestDatabase({ migrate: false });

  try {
    const migrations = await loadMigrations();
    assertThrows(
      () => assertSchemaCurrent(testDb.db, migrations),
      MigrationError,
      "Banco não migrado",
    );
  } finally {
    testDb.cleanup();
  }
});

Deno.test("assertSchemaCurrent recusa schema desatualizado", async () => {
  const testDb = await createTestDatabase();

  try {
    const migrations = await loadMigrations();
    assertThrows(
      () =>
        assertSchemaCurrent(testDb.db, [...migrations, {
          version: 999,
          name: "999_futura.sql",
          sql: "SELECT 1;",
          checksum: "0".repeat(64),
        }]),
      MigrationError,
      "Schema desatualizado",
    );
  } finally {
    testDb.cleanup();
  }
});

Deno.test("inspectSchema descreve banco migrado", async () => {
  const testDb = await createTestDatabase();

  try {
    const migrations = await loadMigrations();
    const status = inspectSchema(testDb.db, migrations);

    assertEquals(status.current, true);
    assertEquals(status.applied, migrations.length);
    assertEquals(status.pending, []);
    assertEquals(status.issues, []);
  } finally {
    testDb.cleanup();
  }
});

Deno.test("inspectSchema aponta migração pendente", async () => {
  const testDb = await createTestDatabase();

  try {
    const migrations = await loadMigrations();
    const last = migrations.at(-1);
    assertExists(last);

    testDb.db
      .prepare<[number]>("DELETE FROM schema_migrations WHERE version = ?")
      .run(last.version);

    const status = inspectSchema(testDb.db, migrations);

    assertEquals(status.current, false);
    assertEquals(status.applied, migrations.length - 1);
    assertEquals(status.pending, [last.name]);
    assertEquals(status.issues[0]?.includes("Schema desatualizado"), true);
  } finally {
    testDb.cleanup();
  }
});

Deno.test("inspectSchema aponta migração aplicada sem arquivo", async () => {
  const testDb = await createTestDatabase();

  try {
    const migrations = await loadMigrations();

    testDb.db
      .prepare<[number, string, string]>(
        `INSERT INTO schema_migrations (version, name, checksum, applied_at, execution_time_ms)
         VALUES (?, '999_futura.sql', ?, ?, 0)`,
      )
      .run(999, "0".repeat(64), new Date().toISOString());

    const status = inspectSchema(testDb.db, migrations);

    assertEquals(status.current, false);
    assertEquals(status.issues[0]?.includes("não existe mais"), true);
  } finally {
    testDb.cleanup();
  }
});

Deno.test("inspectSchema aponta checksum divergente", async () => {
  const testDb = await createTestDatabase();

  try {
    const migrations = await loadMigrations();

    testDb.db
      .prepare<[string, number]>("UPDATE schema_migrations SET checksum = ? WHERE version = ?")
      .run("f".repeat(64), 1);

    const status = inspectSchema(testDb.db, migrations);

    assertEquals(status.current, false);
    assertEquals(status.issues[0]?.includes("Checksum divergente"), true);
  } finally {
    testDb.cleanup();
  }
});
