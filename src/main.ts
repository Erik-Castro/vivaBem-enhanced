import { type AppConfig, ConfigError, loadConfig } from "./config.ts";
import { createLogger } from "./shared/logger/index.ts";
import { createDatabase } from "./db/client.ts";
import { loadMigrations, migrate, MigrationError, type MigrationFile } from "./db/migrate.ts";
import { runMaintenance } from "./db/maintenance.ts";
import { createApp } from "./app.ts";
import { APP_VERSION } from "./version.ts";
import { RecurringRepository } from "./modules/recurring/recurring.repository.ts";
import { RecurringService } from "./modules/recurring/recurring.service.ts";
import { TransactionsRepository } from "./modules/transactions/transactions.repository.ts";
import { AccountsRepository } from "./modules/accounts/accounts.repository.ts";
import { CategoriesRepository } from "./modules/categories/categories.repository.ts";
import { seedAchievements } from "./modules/achievements/achievements.seed.ts";
import { EventPublisher } from "./events/event-publisher.ts";
import { createEmbeddingsService } from "./ai/ai.runtime.ts";

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

// A API é dona do schema: o worker independente apenas verifica se ele está em
// dia (`assertSchemaCurrent`). Migração nunca roda em dois processos.
let migrations: readonly MigrationFile[] = [];
try {
  migrations = await loadMigrations();
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

/** Limpeza operacional: sessões expiradas, outbox antigo, IPs e embeddings. */
function applyMaintenance(): void {
  try {
    const result = runMaintenance(db);
    logger.info("maintenance_complete", { ...result });
  } catch (error) {
    logger.error("maintenance_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

applyMaintenance();
const maintenanceTimer = setInterval(applyMaintenance, 24 * 60 * 60 * 1_000);

// A API consome o outbox apenas pela leitura de embeddings. Provider, processor,
// executor e correlações vivem no processo `src/worker/main.ts`.
const embeddings = createEmbeddingsService({ db, config, logger });

const app = createApp({ db, config, logger, embeddings, migrations });

// Catálogo de conquistas é idempotente por título: reiniciar não duplica.
try {
  const seeded = seedAchievements(db);
  logger.info("achievements_seeded", {
    inserted: seeded.inserted,
    total: seeded.total,
  });
} catch (error) {
  logger.error("achievements_seed_failed", {
    message: error instanceof Error ? error.message : String(error),
  });
}

// Catch-up de recorrências vencidas: o processo pode ter ficado parado entre
// execuções, então materializamos o que já passou antes de aceitar tráfego.
try {
  const recurringService = new RecurringService({
    db,
    repository: new RecurringRepository(db),
    transactions: new TransactionsRepository(db),
    accounts: new AccountsRepository(db),
    categories: new CategoriesRepository(db),
    events: new EventPublisher({ db, config, logger }),
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

  clearInterval(maintenanceTimer);

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
