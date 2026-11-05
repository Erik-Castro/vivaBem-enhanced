import { ConfigError, loadConfig } from "../config.ts";
import { createLogger } from "../shared/logger/index.ts";
import { createDatabase } from "./client.ts";
import { loadMigrations, migrate } from "./migrate.ts";

try {
  const config = loadConfig();

  if (config.databasePath === ":memory:") {
    throw new ConfigError("db:reset não pode ser usado com DATABASE_PATH=:memory:");
  }

  const logger = createLogger({ level: config.logLevel });

  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      Deno.removeSync(`${config.databasePath}${suffix}`);
      logger.info("database_file_removed", { file: `${config.databasePath}${suffix}` });
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }

  const db = createDatabase({
    path: config.databasePath,
    vectorExtensionPath: config.vectorExtensionPath,
  });

  try {
    const migrations = await loadMigrations();
    const result = migrate(db, migrations, logger);
    logger.info("database_reset", {
      database: config.databasePath,
      migrations: result.applied.length,
    });
  } finally {
    db.close();
  }
} catch (error) {
  const message = error instanceof ConfigError
    ? [error.message, ...error.details.map((detail) => `- ${detail}`)].join("\n")
    : error instanceof Error
    ? error.message
    : String(error);

  Deno.stderr.writeSync(new TextEncoder().encode(`erro: ${message}\n`));
  Deno.exit(1);
}
