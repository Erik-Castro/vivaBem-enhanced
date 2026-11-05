import { join } from "node:path";
import { type AppDatabase, createDatabase } from "../../src/db/client.ts";
import { loadMigrations, migrate } from "../../src/db/migrate.ts";

export interface TestDatabase {
  readonly db: AppDatabase;
  readonly directory: string;
  readonly path: string;
  cleanup(): void;
}

export interface TestDatabaseOptions {
  readonly migrate?: boolean;
  readonly vector?: boolean;
}

/**
 * Cria um banco real em diretório temporário. Cada teste recebe sua própria
 * conexão — nunca compartilhe estado entre testes.
 */
export async function createTestDatabase(
  options: TestDatabaseOptions = {},
): Promise<TestDatabase> {
  const directory = await Deno.makeTempDir({ prefix: "vivabem-test-" });
  const path = join(directory, "test.db");
  const db = createDatabase({
    path,
    loadVectorExtension: options.vector ?? true,
  });

  if (options.migrate !== false) {
    const migrations = await loadMigrations();
    migrate(db, migrations);
  }

  return {
    db,
    directory,
    path,
    cleanup: () => {
      db.close();
      try {
        Deno.removeSync(directory, { recursive: true });
      } catch {
        // Limpeza best-effort: não falhe o teste por causa do diretório temporário.
      }
    },
  };
}
