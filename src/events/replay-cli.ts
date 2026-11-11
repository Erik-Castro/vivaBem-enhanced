import { ConfigError, loadWorkerConfig } from "../config.ts";
import { createDatabase } from "../db/client.ts";
import { assertSchemaCurrent, loadMigrations, MigrationError } from "../db/migrate.ts";
import type { OutboxEvent } from "./events.types.ts";
import { OutboxRepository } from "./outbox.repository.ts";

/**
 * CLI de reprocessamento manual da outbox.
 *
 * O replay é sempre explícito e auditável: o evento original mantém o
 * identificador e `replay_count`/`replayed_at` registram a intervenção. Replays
 * não dispensam a idempotência dos handlers — reprocessar continua sendo "pelo
 * menos uma vez".
 */
interface CliOptions {
  readonly list: boolean;
  readonly id?: string;
  readonly force: boolean;
  readonly limit: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
/** Estados terminais que interessam ao operador. */
const LISTABLE_STATUSES = ["dead_letter", "failed"] as const;

function usage(): string {
  return [
    "Uso: deno task outbox:replay <comando>",
    "",
    "  --list                 lista eventos em dead letter",
    "  --id=<uuid>            recoloca um evento terminal na fila",
    "  --force                permite replay de evento pendente/em processamento",
    `  --limit=<n>            limite da listagem (padrão ${DEFAULT_LIMIT}, máx ${MAX_LIMIT})`,
    "",
    "Exemplos:",
    "  deno task outbox:replay --list",
    "  deno task outbox:replay --id=0192f0c4-... --force",
  ].join("\n");
}

function parseArgs(args: readonly string[]): CliOptions {
  let list = false;
  let force = false;
  let id: string | undefined;
  let limit = DEFAULT_LIMIT;

  for (const arg of args) {
    if (arg === "--list") {
      list = true;
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--help" || arg === "-h") {
      write(usage());
      Deno.exit(0);
    } else if (arg.startsWith("--id=")) {
      id = arg.slice("--id=".length);
    } else if (arg.startsWith("--limit=")) {
      const parsed = Number(arg.slice("--limit=".length));
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
        throw new Error(`--limit deve ser inteiro entre 1 e ${MAX_LIMIT}`);
      }
      limit = parsed;
    } else {
      throw new Error(`argumento desconhecido: ${arg}`);
    }
  }

  return { list, id, force, limit };
}

const encoder = new TextEncoder();

function write(text: string): void {
  Deno.stdout.writeSync(encoder.encode(`${text}\n`));
}

function summary(event: OutboxEvent): Record<string, unknown> {
  return {
    id: event.id,
    type: event.type,
    status: event.status,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    userId: event.userId,
    attempts: event.attempts,
    replayCount: event.replayCount,
    lastError: event.lastError,
    createdAt: event.createdAt,
    processedAt: event.processedAt,
    replayedAt: event.replayedAt,
  };
}

try {
  const options = parseArgs(Deno.args);

  if (!options.list && options.id === undefined) {
    write(usage());
    Deno.exit(1);
  }
  if (options.list && options.id !== undefined) {
    throw new Error("use --list ou --id, não ambos");
  }

  const config = loadWorkerConfig();
  const db = createDatabase({
    path: config.databasePath,
    vectorExtensionPath: config.vectorExtensionPath,
    loadVectorExtension: false,
  });

  try {
    assertSchemaCurrent(db, await loadMigrations());
    const repository = new OutboxRepository(db);

    if (options.list) {
      const events = repository.listByStatus([...LISTABLE_STATUSES], options.limit);
      write(JSON.stringify({ total: events.length, events: events.map(summary) }, null, 2));
      Deno.exit(0);
    }

    const id = options.id;
    if (id === undefined) {
      throw new Error("--id é obrigatório");
    }

    const outcome = repository.replay(id, new Date().toISOString(), options.force);

    if (outcome === "replayed") {
      const event = repository.findById(id);
      write(JSON.stringify({ outcome, event: event && summary(event) }, null, 2));
      Deno.exit(0);
    }

    write(JSON.stringify({ outcome, id }, null, 2));
    Deno.exit(1);
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
