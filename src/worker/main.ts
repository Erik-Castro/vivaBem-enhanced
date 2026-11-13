import { ConfigError, loadWorkerConfig, type WorkerConfig } from "../config.ts";
import { createLogger } from "../shared/logger/index.ts";
import { createDatabase } from "../db/client.ts";
import { assertSchemaCurrent, loadMigrations, MigrationError } from "../db/migrate.ts";
import { createAiPipeline } from "../ai/ai.runtime.ts";
import { NotificationsPushRepository } from "../modules/notifications/notifications.push.repository.ts";
import { PushDispatcher } from "../modules/notifications/notifications.push.dispatcher.ts";
import { createPushSender } from "../modules/notifications/notifications.push.sender.ts";
import { uuidv7 } from "../shared/utils/uuid.ts";
import { WorkerRuntime } from "./runtime.ts";

const encoder = new TextEncoder();

function fatal(message: string): never {
  Deno.stderr.writeSync(encoder.encode(`erro: ${message}\n`));
  Deno.exit(1);
}

function loadConfiguration(): WorkerConfig {
  try {
    return loadWorkerConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      fatal([error.message, ...error.details.map((detail) => `- ${detail}`)].join("\n"));
    }
    throw error;
  }
}

const config = loadConfiguration();
const logger = createLogger({ level: config.logLevel });

const pushSender = await createPushSender(config.push).catch((error: unknown) => {
  fatal(error instanceof Error ? error.message : String(error));
});

// Sem IA e sem push não existe trabalho: o processo encerra com código 0 para
// que o supervisor (Docker, systemd) não o reinicie em loop.
if (!config.ai.enabled && pushSender === null) {
  logger.info("worker_disabled", {
    message: "AI_ENABLED=false e PUSH_ENABLED=false; nada a processar",
  });
  Deno.exit(0);
}

const workerId = config.worker.id ?? `worker-${uuidv7()}`;

// O worker abre a própria conexão: nenhum objeto de banco é compartilhado com a
// API, apenas o arquivo SQLite (WAL + busy_timeout cuidam da concorrência).
const db = createDatabase({
  path: config.databasePath,
  vectorExtensionPath: config.vectorExtensionPath,
});

try {
  const migrations = await loadMigrations();
  assertSchemaCurrent(db, migrations);
} catch (error) {
  db.close();
  if (error instanceof MigrationError) fatal(error.message);
  fatal(error instanceof Error ? error.message : String(error));
}

const pipeline = config.ai.enabled ? createAiPipeline({ db, config, logger }) : null;

if (config.ai.enabled && pipeline === null) {
  db.close();
  fatal("pipeline de IA indisponível com AI_ENABLED=true");
}

const runtime = pipeline === null ? null : new WorkerRuntime({
  db,
  config,
  logger,
  processor: pipeline.processor,
  correlations: pipeline.correlations,
  workerId,
});

runtime?.start();

// Push é independente da IA: o dispatcher só existe com PUSH_ENABLED=true e
// reaproveita a mesma conexão/lease do processo.
const pushDispatcher = pushSender === null ? null : new PushDispatcher({
  repository: new NotificationsPushRepository(db),
  sender: pushSender,
  config: config.push,
  logger,
  workerId,
});

pushDispatcher?.start();

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info("shutdown_started", { signal, workerId });

  try {
    await runtime?.stop();
    await pushDispatcher?.stop();
  } catch (error) {
    logger.error("worker_stop_failed", {
      workerId,
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    db.close();
  }

  logger.info("shutdown_complete", { workerId });
  Deno.exit(0);
}

Deno.addSignalListener("SIGINT", () => {
  void shutdown("SIGINT");
});
Deno.addSignalListener("SIGTERM", () => {
  void shutdown("SIGTERM");
});

// O loop de polling usa timers `unref`, então nada manteria o processo vivo
// quando o outbox está vazio. A promessa pendente é o que sustenta o processo
// principal até o encerramento por sinal.
await new Promise<void>(() => {});
