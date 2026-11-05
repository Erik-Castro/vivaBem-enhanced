import { dirname, join } from "node:path";
import { ConfigError, loadConfig } from "../config.ts";
import { createLogger } from "../shared/logger/index.ts";
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
    const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
    const target = join("backups", `app-${timestamp}.db`);

    Deno.mkdirSync(dirname(target), { recursive: true });
    db.raw.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);

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
