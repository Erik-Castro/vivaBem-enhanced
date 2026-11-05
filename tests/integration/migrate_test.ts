import { assertEquals, assertThrows } from "@std/assert";
import { loadMigrations, migrate, MigrationError } from "../../src/db/migrate.ts";
import { createTestDatabase } from "../helpers/db.ts";

Deno.test("loadMigrations carrega as migrações em ordem", async () => {
  const migrations = await loadMigrations();

  assertEquals(migrations.length >= 1, true);
  assertEquals(migrations[0]?.name, "001_core.sql");
  assertEquals(migrations[0]?.version, 1);
  assertEquals(migrations[0]?.checksum.length, 64);
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
