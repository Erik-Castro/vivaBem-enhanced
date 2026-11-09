import { assert, assertEquals } from "@std/assert";
import { join } from "node:path";
import { createTestDatabase } from "../helpers/db.ts";
import { backupDatabase } from "../../src/db/backup.ts";
import { createDatabase } from "../../src/db/client.ts";

Deno.test("backup gera uma cópia consultável e independente do banco original", async () => {
  const database = await createTestDatabase();
  const backupDirectory = await Deno.makeTempDir({ prefix: "vivabem-backup-" });

  try {
    const now = new Date("2026-11-09T12:34:56.789Z");
    database.db
      .prepare(
        `INSERT INTO user_profiles (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      )
      .run("user-1", "Ana", now.toISOString(), now.toISOString());

    const target = backupDatabase(database.db, { directory: backupDirectory, now });
    assertEquals(target, join(backupDirectory, "app-2026-11-09T12-34-56Z.db"));
    assert((await Deno.stat(target)).isFile);

    const copy = createDatabase({ path: target, loadVectorExtension: false });
    try {
      const row = copy
        .prepare<[], { name: string; count: number }>(
          `SELECT name, (SELECT COUNT(*) FROM schema_migrations) AS count
           FROM user_profiles LIMIT 1`,
        )
        .get();
      assertEquals(row?.name, "Ana");
      assert((row?.count ?? 0) > 0, "o backup deve conter o schema migrado");
    } finally {
      copy.close();
    }

    // O backup é um snapshot: escrever no original não altera a cópia.
    database.db
      .prepare("UPDATE user_profiles SET name = ? WHERE id = ?")
      .run("Bia", "user-1");

    const copyAgain = createDatabase({ path: target, loadVectorExtension: false });
    try {
      const row = copyAgain
        .prepare<[], { name: string }>("SELECT name FROM user_profiles LIMIT 1")
        .get();
      assertEquals(row?.name, "Ana");
    } finally {
      copyAgain.close();
    }
  } finally {
    database.cleanup();
    Deno.removeSync(backupDirectory, { recursive: true });
  }
});

Deno.test("backup cria o diretório de destino quando ele não existe", async () => {
  const database = await createTestDatabase();
  const base = await Deno.makeTempDir({ prefix: "vivabem-backup-" });
  const nested = join(base, "nested", "backups");

  try {
    const target = backupDatabase(database.db, {
      directory: nested,
      now: new Date("2026-11-09T00:00:00.000Z"),
    });
    assertEquals((await Deno.stat(target)).isFile, true);
  } finally {
    database.cleanup();
    Deno.removeSync(base, { recursive: true });
  }
});
