import { type AppConfig, ConfigError, loadConfig } from "./config.ts";
import { createLogger } from "./shared/logger/index.ts";
import { createDatabase } from "./db/client.ts";
import { loadMigrations, migrate, MigrationError } from "./db/migrate.ts";
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
import { EventWorker } from "./events/worker.ts";
import { createAiProvider } from "./ai/providers/factory.ts";
import { createContextRegistry } from "./ai/ai.context.ts";
import { AiToolExecutor } from "./ai/ai.executor.ts";
import { AiProcessor } from "./ai/ai.processor.ts";
import { EmbeddingsService } from "./ai/embeddings.service.ts";
import { CorrelationScheduler } from "./ai/ai.correlation.ts";
import { createAiToolRegistry } from "./ai/tools/index.ts";
import { AuthRepository } from "./modules/auth/auth.repository.ts";
import { InsightsRepository } from "./modules/insights/insights.repository.ts";
import { NotificationsRepository } from "./modules/notifications/notifications.repository.ts";
import { IpBlocklistRepository } from "./modules/security/ip-blocklist.repository.ts";

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

/**
 * Monta o pipeline de IA quando habilitado. Sem `AI_ENABLED`, retorna `null`:
 * nenhum provider é instanciado e nenhum worker roda.
 */
function createAiRuntime(): { embeddings: EmbeddingsService; worker: EventWorker } | null {
  const provider = createAiProvider(config);
  if (provider === null) return null;

  const publisher = new EventPublisher({ db, config, logger });
  const embeddings = new EmbeddingsService({ db, provider, logger });
  const registry = createAiToolRegistry({
    notifications: new NotificationsRepository(db),
    insights: new InsightsRepository(db),
    auth: new AuthRepository(db),
    blocklist: new IpBlocklistRepository(db),
    logger,
  });
  const executor = new AiToolExecutor({ db, config, logger, registry, publisher });
  const processor = new AiProcessor({
    config,
    logger,
    provider,
    contexts: createContextRegistry(db),
    executor,
    embeddings,
  });
  const correlations = new CorrelationScheduler({
    db,
    publisher,
    threshold: config.ai.correlationThreshold,
  });
  const worker = new EventWorker({ db, config, logger, processor, correlations });

  logger.info("ai_runtime_ready", {
    provider: provider.name,
    chatModel: provider.chatModel,
    embeddingsModel: provider.embeddingsModel,
    dimensions: provider.embeddingDimensions,
    vectorEnabled: db.vectorEnabled,
  });

  return { embeddings, worker };
}

const aiRuntime = createAiRuntime();
const app = createApp({ db, config, logger, embeddings: aiRuntime?.embeddings ?? null });

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

aiRuntime?.worker.start();

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

  aiRuntime?.worker.stop();
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
