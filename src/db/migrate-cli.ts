import { ConfigError, loadConfig } from "../config.ts";
import { createLogger } from "../shared/logger/index.ts";
import { createDatabase } from "./client.ts";
import { loadMigrations, migrate, MigrationError } from "./migrate.ts";

try {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel });
  const db = createDatabase({
    path: config.databasePath,
    vectorExtensionPath: config.vectorExtensionPath,
  });

  try {
    const migrations = await loadMigrations();
    const result = migrate(db, migrations, logger);
    logger.info("migrations_complete", {
      applied: result.applied.length,
      total: result.total,
      database: config.databasePath,
    });
  } finally {
    db.close();
  }
} catch (error) {
  const message = error instanceof ConfigError
    ? [error.message, ...error.details.map((detail) => `- ${detail}`)].join("\n")
    : error instanceof MigrationError
    ? error.message
    : error instanceof Error
    ? error.message
    : String(error);

  Deno.stderr.writeSync(new TextEncoder().encode(`erro: ${message}\n`));
  Deno.exit(1);
}
