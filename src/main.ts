import { type AppConfig, ConfigError, loadConfig } from "./config.ts";
import { createLogger } from "./shared/logger/index.ts";
import { createDatabase } from "./db/client.ts";
import { loadMigrations, migrate, MigrationError } from "./db/migrate.ts";
import { createApp } from "./app.ts";
import { APP_VERSION } from "./version.ts";
import { RecurringRepository } from "./modules/recurring/recurring.repository.ts";
import { RecurringService } from "./modules/recurring/recurring.service.ts";
import { TransactionsRepository } from "./modules/transactions/transactions.repository.ts";
import { AccountsRepository } from "./modules/accounts/accounts.repository.ts";
import { CategoriesRepository } from "./modules/categories/categories.repository.ts";

const encoder = new TextEncoder();

function fatal(message: string): never {
  Deno.stderr.writeSync(encoder.encode(`erro: ${message}\n`));
  Deno.exit(1);
}

function loadConfiguration(): AppConfig {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      fatal([error.message, ...error.details.map((detail) => `- ${detail}`)].join("\n"));
    }
    throw error;
  }
}

const config = loadConfiguration();
const logger = createLogger({ level: config.logLevel });

if (config.jwtSecretIsEphemeral) {
  logger.warn("jwt_secret_ephemeral", {
    message: "JWT_SECRET não definido; usando segredo efêmero (não use em produção)",
  });
}

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
  });
} catch (error) {
  db.close();
  if (error instanceof MigrationError) fatal(error.message);
  fatal(error instanceof Error ? error.message : String(error));
}

const app = createApp({ db, config, logger });

// Catch-up de recorrências vencidas: o processo pode ter ficado parado entre
// execuções, então materializamos o que já passou antes de aceitar tráfego.
try {
  const recurringService = new RecurringService({
    db,
    repository: new RecurringRepository(db),
    transactions: new TransactionsRepository(db),
    accounts: new AccountsRepository(db),
    categories: new CategoriesRepository(db),
  });
  const result = recurringService.processDue();
  logger.info("recurring_due_processed", { ...result });
} catch (error) {
  logger.error("recurring_due_failed", {
    message: error instanceof Error ? error.message : String(error),
  });
}

const server = Deno.serve(
  {
    port: config.port,
    hostname: "0.0.0.0",
    onListen: ({ port }) => {
      logger.info("server_started", {
        port,
        env: config.env,
        version: APP_VERSION,
        database: config.databasePath,
      });
    },
  },
  app.fetch,
);

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info("shutdown_started", { signal });

  try {
    await server.shutdown();
  } finally {
    db.close();
  }

  logger.info("shutdown_complete");
  Deno.exit(0);
}

Deno.addSignalListener("SIGINT", () => {
  void shutdown("SIGINT");
});
Deno.addSignalListener("SIGTERM", () => {
  void shutdown("SIGTERM");
});
