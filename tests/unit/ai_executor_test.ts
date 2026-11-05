import { assertEquals, assertExists } from "@std/assert";
import { z } from "zod";
import { loadConfig } from "../../src/config.ts";
import type { AppDatabase } from "../../src/db/client.ts";
import { createLogger } from "../../src/shared/logger/index.ts";
import { EventPublisher } from "../../src/events/event-publisher.ts";
import { AiToolExecutor } from "../../src/ai/ai.executor.ts";
import { AiToolRegistry } from "../../src/ai/ai.registry.ts";
import type { AiResponse, AiToolContext, AiToolDefinition } from "../../src/ai/ai.types.ts";
import { uuidv7 } from "../../src/shared/utils/uuid.ts";
import { createTestDatabase, type TestDatabase } from "../helpers/db.ts";

const AI_ENV = {
  AI_ENABLED: "true",
  AI_API_BASE_URL: "http://localhost:9999/v1",
  AI_API_MODEL_CHAT_NAME: "test-chat",
  AI_API_MODEL_EMBEDDINGS_NAME: "test-embedding",
  AI_EMBEDDING_DIMENSIONS: "8",
} as const;

const logger = createLogger({ level: "error", silent: true });
const USER_ID = uuidv7();
const EVENT_ID = uuidv7();

function createUser(db: AppDatabase, aiEnabled: boolean): void {
  const now = new Date().toISOString();
  db.prepare<[string, string, string, string]>(
    `INSERT INTO user_profiles (id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).run(USER_ID, "Ana", now, now);
  db.prepare<[string, number, string]>(
    `INSERT INTO user_preferences (user_id, ai_enabled, updated_at)
     VALUES (?, ?, ?)`,
  ).run(USER_ID, aiEnabled ? 1 : 0, now);
}

function context(now: string): AiToolContext {
  return {
    userId: USER_ID,
    eventId: EVENT_ID,
    confidence: 0.9,
    sourceEvent: "finance.transaction.created",
    now,
  };
}

function response(
  toolCalls: AiResponse["toolCalls"],
  confidence = 0.9,
): AiResponse {
  return {
    confidence,
    analysis: { risk: "low", summary: "teste" },
    toolCalls,
  };
}

const valueParameters = z.object({ value: z.number() });

function tool(
  name: string,
  overrides: Partial<AiToolDefinition> = {},
): AiToolDefinition {
  const base: AiToolDefinition = {
    name,
    description: name,
    category: "finance",
    risk: "low",
    parameters: valueParameters,
    cooldownSeconds: 0,
    executor: () => ({ success: true, message: "ok" }),
  };

  return { ...base, ...overrides };
}

function auditRows(db: AppDatabase): Array<{
  tool: string;
  executed: number;
  error: string | null;
  arguments: string;
}> {
  return db
    .prepare<[], { tool: string; executed: number; error: string | null; arguments: string }>(
      "SELECT tool, executed, error, arguments FROM ai_action_logs ORDER BY rowid",
    )
    .all();
}

async function setup(
  options: { aiEnabled?: boolean; env?: Record<string, string> } = {},
): Promise<{
  database: TestDatabase;
  executor: AiToolExecutor;
  registry: AiToolRegistry;
  now: string;
}> {
  const database = await createTestDatabase();
  createUser(database.db, options.aiEnabled ?? false);

  const config = loadConfig({
    AI_CONFIDENCE_THRESHOLD: "0.5",
    ...options.env,
  });
  const registry = new AiToolRegistry();
  const publisher = new EventPublisher({ db: database.db, config, logger });
  const executor = new AiToolExecutor({
    db: database.db,
    config,
    logger,
    registry,
    publisher,
  });

  return { database, executor, registry, now: new Date().toISOString() };
}

Deno.test("executor executa ferramenta válida e audita", async () => {
  const { database, executor, registry, now } = await setup();
  try {
    registry.register(tool("create_insight"));

    const summary = await executor.execute(
      response([{ name: "create_insight", arguments: { value: 10 } }]),
      context(now),
    );

    assertEquals(summary, { attempted: 1, executed: 1, skipped: 0 });
    const rows = auditRows(database.db);
    assertEquals(rows.length, 1);
    assertEquals(rows[0]?.executed, 1);
    assertEquals(rows[0]?.error, null);
  } finally {
    database.cleanup();
  }
});

Deno.test("executor ignora ferramenta desconhecida", async () => {
  const { database, executor, now } = await setup();
  try {
    const summary = await executor.execute(
      response([{ name: "drop_database", arguments: {} }]),
      context(now),
    );

    assertEquals(summary, { attempted: 1, executed: 0, skipped: 1 });
    assertEquals(auditRows(database.db)[0]?.error, "tool_desconhecida");
  } finally {
    database.cleanup();
  }
});

Deno.test("executor bloqueia confiança abaixo do limiar", async () => {
  const { database, executor, registry, now } = await setup();
  try {
    registry.register(tool("create_insight"));

    const summary = await executor.execute(
      response([{ name: "create_insight", arguments: { value: 1 } }], 0.4),
      context(now),
    );

    assertEquals(summary, { attempted: 1, executed: 0, skipped: 1 });
    assertEquals(auditRows(database.db)[0]?.error, "confianca_abaixo_do_limiar");
  } finally {
    database.cleanup();
  }
});

Deno.test("executor exige confiança alta para ferramentas de risco alto", async () => {
  const { database, executor, registry, now } = await setup();
  try {
    registry.register(tool("block_ip", { risk: "high" }));

    const below = await executor.execute(
      response([{ name: "block_ip", arguments: { value: 1 } }], 0.8),
      context(now),
    );
    assertEquals(below.executed, 0);
    assertEquals(auditRows(database.db)[0]?.error, "confianca_abaixo_do_limiar");

    const above = await executor.execute(
      response([{ name: "block_ip", arguments: { value: 1 } }], 0.95),
      context(now),
    );
    assertEquals(above.executed, 1);
  } finally {
    database.cleanup();
  }
});

Deno.test("executor rejeita argumentos fora do schema", async () => {
  const { database, executor, registry, now } = await setup();
  try {
    registry.register(tool("create_insight"));

    const summary = await executor.execute(
      response([{ name: "create_insight", arguments: { value: "dez" } }]),
      context(now),
    );

    assertEquals(summary, { attempted: 1, executed: 0, skipped: 1 });
    assertEquals(auditRows(database.db)[0]?.error, "argumentos_invalidos");
  } finally {
    database.cleanup();
  }
});

Deno.test("executor deduplica a mesma tool com os mesmos argumentos", async () => {
  const { database, executor, registry, now } = await setup();
  try {
    registry.register(tool("create_insight"));

    await executor.execute(
      response([{ name: "create_insight", arguments: { value: 7 } }]),
      context(now),
    );
    const duplicate = await executor.execute(
      response([{ name: "create_insight", arguments: { value: 7 } }]),
      context(now),
    );

    assertEquals(duplicate, { attempted: 1, executed: 0, skipped: 1 });
    const rows = auditRows(database.db);
    assertEquals(rows[1]?.error, "duplicado");
  } finally {
    database.cleanup();
  }
});

Deno.test("executor respeita cooldown mesmo com argumentos diferentes", async () => {
  const { database, executor, registry, now } = await setup();
  try {
    registry.register(tool("notify_user", { cooldownSeconds: 60 }));

    const first = await executor.execute(
      response([{ name: "notify_user", arguments: { value: 1 } }]),
      context(now),
    );
    assertEquals(first.executed, 1);

    const second = await executor.execute(
      response([{ name: "notify_user", arguments: { value: 2 } }]),
      context(now),
    );
    assertEquals(second, { attempted: 1, executed: 0, skipped: 1 });
    assertEquals(auditRows(database.db)[1]?.error, "cooldown_ativo");
  } finally {
    database.cleanup();
  }
});

Deno.test("executor audita falha da ferramenta sem contar como executada", async () => {
  const { database, executor, registry, now } = await setup();
  try {
    registry.register(
      tool("create_insight", {
        executor: () => ({ success: false, message: "sem permissão" }),
      }),
    );

    const summary = await executor.execute(
      response([{ name: "create_insight", arguments: { value: 1 } }]),
      context(now),
    );

    assertEquals(summary, { attempted: 1, executed: 0, skipped: 1 });
    const row = auditRows(database.db)[0];
    assertEquals(row?.executed, 0);
    assertEquals(row?.error, "sem permissão");
  } finally {
    database.cleanup();
  }
});

Deno.test("executor audita exceção da ferramenta e continua o lote", async () => {
  const { database, executor, registry, now } = await setup();
  try {
    registry.register(
      tool("explode", {
        executor: () => {
          throw new Error("boom");
        },
      }),
    );
    registry.register(tool("create_insight"));

    const summary = await executor.execute(
      response([
        { name: "explode", arguments: { value: 1 } },
        { name: "create_insight", arguments: { value: 2 } },
      ]),
      context(now),
    );

    assertEquals(summary, { attempted: 2, executed: 1, skipped: 1 });
    const rows = auditRows(database.db);
    assertEquals(rows[0]?.error, "boom");
    assertEquals(rows[1]?.executed, 1);
  } finally {
    database.cleanup();
  }
});

Deno.test("executor agenda embedding quando a ferramenta pede indexação", async () => {
  const { database, executor, registry, now } = await setup({
    aiEnabled: true,
    env: AI_ENV,
  });
  try {
    registry.register(
      tool("create_insight", {
        executor: () => ({
          success: true,
          message: "criado",
          embedding: {
            sourceType: "insight",
            sourceId: "insight-1",
            content: "conteúdo indexável",
          },
        }),
      }),
    );

    const summary = await executor.execute(
      response([{ name: "create_insight", arguments: { value: 1 } }]),
      context(now),
    );

    assertEquals(summary.executed, 1);
    const event = database.db
      .prepare<[string], { type: string; payload: string }>(
        "SELECT type, payload FROM event_outbox WHERE user_id = ?",
      )
      .get(USER_ID);
    assertExists(event);
    assertEquals(event.type, "embedding.requested");
    assertEquals(JSON.parse(event.payload).sourceId, "insight-1");
  } finally {
    database.cleanup();
  }
});
