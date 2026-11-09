import { ConfigError, loadConfig } from "../config.ts";
import { createLogger } from "../shared/logger/index.ts";
import { backupDatabase } from "./backup.ts";
import { createDatabase } from "./client.ts";

try {
  const config = loadConfig();

  if (config.databasePath === ":memory:") {
    throw new ConfigError("db:backup não pode ser usado com DATABASE_PATH=:memory:");
  }

  const logger = createLogger({ level: config.logLevel });
  const db = createDatabase({
    path: config.databasePath,
    vectorExtensionPath: config.vectorExtensionPath,
    loadVectorExtension: false,
  });

  try {
    const target = backupDatabase(db);

    logger.info("database_backup_created", { source: config.databasePath, target });
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
