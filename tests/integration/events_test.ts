import { assertEquals, assertExists } from "@std/assert";
import { loadConfig } from "../../src/config.ts";
import { createLogger } from "../../src/shared/logger/index.ts";
import type { AppDatabase } from "../../src/db/client.ts";
import { EventPublisher } from "../../src/events/event-publisher.ts";
import { OutboxRepository } from "../../src/events/outbox.repository.ts";
import { backoffMs, EventWorker } from "../../src/events/worker.ts";
import type { AiProcessor } from "../../src/ai/ai.processor.ts";
import type { CorrelationScheduler } from "../../src/ai/ai.correlation.ts";
import { uuidv7 } from "../../src/shared/utils/uuid.ts";
import { createTestDatabase, type TestDatabase } from "../helpers/db.ts";
import { createTestApp } from "../helpers/app.ts";
import { AuthTestClient } from "../helpers/auth-client.ts";

const AI_ENV = {
  AI_ENABLED: "true",
  AI_API_BASE_URL: "http://localhost:9999/v1",
  AI_API_MODEL_CHAT_NAME: "test-chat",
  AI_API_MODEL_EMBEDDINGS_NAME: "test-embedding",
  AI_EMBEDDING_DIMENSIONS: "8",
} as const;

const logger = createLogger({ level: "error", silent: true });

function createUser(db: AppDatabase, id: string, aiEnabled: boolean): void {
  const now = new Date().toISOString();
  db.prepare<[string, string, string, string]>(
    `INSERT INTO user_profiles (id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).run(id, "Ana", now, now);

  db.prepare<[string, number, string]>(
    `INSERT INTO user_preferences (user_id, ai_enabled, updated_at)
     VALUES (?, ?, ?)`,
  ).run(id, aiEnabled ? 1 : 0, now);
}

function insertEvent(
  repository: OutboxRepository,
  userId: string,
  overrides: Partial<{
    type: Parameters<OutboxRepository["insert"]>[0]["type"];
    priority: number;
    availableAt: string;
    payload: Record<string, unknown>;
  }> = {},
): string {
  const now = new Date().toISOString();
  const id = uuidv7();

  repository.insert({
    id,
    type: overrides.type ?? "finance.transaction.created",
    aggregateType: "transaction",
    aggregateId: uuidv7(),
    userId,
    payload: overrides.payload ?? { amountMinor: 1_000 },
    priority: overrides.priority ?? 0,
    availableAt: overrides.availableAt ?? now,
    now,
  });

  return id;
}

async function withDatabase(
  fn: (database: TestDatabase, userId: string) => Promise<void> | void,
): Promise<void> {
  const database = await createTestDatabase();
  const userId = uuidv7();

  try {
    createUser(database.db, userId, true);
    await fn(database, userId);
  } finally {
    database.cleanup();
  }
}

Deno.test("publisher não grava quando a IA está desligada", async () => {
  await withDatabase((database, userId) => {
    const config = loadConfig({});
    const publisher = new EventPublisher({ db: database.db, config, logger });

    assertEquals(publisher.isEnabledFor(userId), false);
    assertEquals(
      publisher.publish({
        type: "finance.transaction.created",
        aggregateType: "transaction",
        userId,
        payload: {},
      }),
      null,
    );
    assertEquals(new OutboxRepository(database.db).stats().pending, 0);
  });
});

Deno.test("publisher respeita o opt-in do usuário", async () => {
  await withDatabase((database, userId) => {
    const config = loadConfig(AI_ENV);
    const publisher = new EventPublisher({ db: database.db, config, logger });

    // A IA está ligada globalmente, mas o usuário não autorizou.
    database.db
      .prepare<[string]>("UPDATE user_preferences SET ai_enabled = 0 WHERE user_id = ?")
      .run(userId);

    assertEquals(publisher.isEnabledFor(userId), false);
    assertEquals(
      publisher.publish({
        type: "finance.transaction.created",
        aggregateType: "transaction",
        userId,
        payload: {},
      }),
      null,
    );

    database.db
      .prepare<[string]>("UPDATE user_preferences SET ai_enabled = 1 WHERE user_id = ?")
      .run(userId);

    const id = publisher.publish({
      type: "finance.transaction.created",
      aggregateType: "transaction",
      aggregateId: "tx-1",
      userId,
      payload: { amountMinor: 2_500 },
    });

    assertExists(id);
    const event = new OutboxRepository(database.db).findById(id);
    assertExists(event);
    assertEquals(event.status, "pending");
    assertEquals(event.attempts, 0);
    assertEquals(event.payload, { amountMinor: 2_500 });
  });
});

Deno.test("claim é atômico e prioriza maior prioridade", async () => {
  await withDatabase((database, userId) => {
    const repository = new OutboxRepository(database.db);
    const low = insertEvent(repository, userId, { priority: 0 });
    const high = insertEvent(repository, userId, { priority: 10 });

    const first = repository.claimNext("worker-a", new Date().toISOString());
    assertExists(first);
    assertEquals(first.id, high);

    const second = repository.claimNext("worker-b", new Date().toISOString());
    assertExists(second);
    assertEquals(second.id, low);

    // Sem eventos pendentes, o terceiro claim não devolve nada.
    assertEquals(repository.claimNext("worker-c", new Date().toISOString()), null);

    assertEquals(repository.findById(high)?.status, "processing");
    assertEquals(repository.findById(high)?.attempts, 1);
    assertEquals(repository.findById(high)?.workerId, "worker-a");
  });
});

Deno.test("claim ignora eventos ainda não disponíveis", async () => {
  await withDatabase((database, userId) => {
    const repository = new OutboxRepository(database.db);
    const future = new Date(Date.now() + 60_000).toISOString();
    insertEvent(repository, userId, { availableAt: future });

    assertEquals(repository.claimNext("worker-a", new Date().toISOString()), null);
    assertEquals(repository.stats().pending, 1);
  });
});

Deno.test("complete e fail controlam o ciclo de vida do evento", async () => {
  await withDatabase((database, userId) => {
    const repository = new OutboxRepository(database.db);
    const completedId = insertEvent(repository, userId);
    const retryId = insertEvent(repository, userId);
    const deadId = insertEvent(repository, userId);

    const now = new Date().toISOString();
    const completed = repository.claimNext("worker-a", now);
    assertExists(completed);
    repository.complete(completed.id, now);
    assertEquals(repository.findById(completedId)?.status, "completed");
    assertEquals(repository.findById(completedId)?.lockedAt, null);

    const retryEvent = repository.claimNext("worker-a", now);
    assertExists(retryEvent);
    const willRetry = repository.fail(
      retryEvent,
      "provider indisponível",
      now,
      new Date(Date.now() + 5_000).toISOString(),
      3,
    );
    assertEquals(willRetry, true);
    const retried = repository.findById(retryId);
    assertEquals(retried?.status, "pending");
    assertEquals(retried?.lastError, "provider indisponível");
    assertEquals(retried?.attempts, 1);

    const deadEvent = repository.claimNext("worker-a", now);
    assertExists(deadEvent);
    const deadWillRetry = repository.fail(
      deadEvent,
      "erro definitivo",
      now,
      now,
      1,
    );
    assertEquals(deadWillRetry, false);
    assertEquals(repository.findById(deadId)?.status, "failed");
  });
});

Deno.test("recoverStuck devolve lease vencido e mata tentativas esgotadas", async () => {
  await withDatabase((database, userId) => {
    const repository = new OutboxRepository(database.db);
    const retryId = insertEvent(repository, userId);
    const deadId = insertEvent(repository, userId);

    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    const claimedAt = new Date().toISOString();
    const first = repository.claimNext("worker-a", claimedAt);
    assertExists(first);
    const second = repository.claimNext("worker-a", claimedAt);
    assertExists(second);

    // Simula leases vencidos: ambos os eventos foram reivindicados há 10 min.
    database.db
      .prepare<[string, string, string]>(
        "UPDATE event_outbox SET locked_at = ? WHERE id IN (?, ?)",
      )
      .run(old, retryId, deadId);

    // Força o segundo evento a já ter esgotado as tentativas.
    database.db
      .prepare<[number, string]>("UPDATE event_outbox SET attempts = ? WHERE id = ?")
      .run(2, deadId);

    const now = new Date().toISOString();
    const cutoff = new Date(Date.now() - 60_000).toISOString();
    const recovered = repository.recoverStuck(cutoff, now, 2);

    assertEquals(recovered, 2);
    assertEquals(repository.findById(retryId)?.status, "pending");
    assertEquals(repository.findById(retryId)?.lastError, "lease expirado");
    assertEquals(repository.findById(deadId)?.status, "failed");
  });
});

Deno.test("hasActiveOfType detecta apenas eventos em andamento", async () => {
  await withDatabase((database, userId) => {
    const repository = new OutboxRepository(database.db);
    const id = insertEvent(repository, userId);

    assertEquals(repository.hasActiveOfType(userId, "finance.transaction.created"), true);

    const event = repository.claimNext("worker-a", new Date().toISOString());
    assertExists(event);
    repository.complete(id, new Date().toISOString());

    assertEquals(repository.hasActiveOfType(userId, "finance.transaction.created"), false);
    assertEquals(repository.hasActiveOfType(userId, "habit.log.created"), false);
  });
});

Deno.test("backoff cresce exponencialmente e para em 5 minutos", () => {
  assertEquals(backoffMs(1), 5_000);
  assertEquals(backoffMs(2), 10_000);
  assertEquals(backoffMs(3), 20_000);
  assertEquals(backoffMs(20), 5 * 60_000);
});

Deno.test("worker completa o evento e agenda correlação", async () => {
  await withDatabase(async (database, userId) => {
    const repository = new OutboxRepository(database.db);
    const config = loadConfig({ AI_MAX_RETRIES: "3" });
    const id = insertEvent(repository, userId);

    let scheduled = 0;
    const worker = new EventWorker({
      db: database.db,
      config,
      logger,
      repository,
      processor: {
        process: () => Promise.resolve({ processed: true, toolCalls: 0, executed: 0 }),
      } as unknown as AiProcessor,
      correlations: {
        maybeSchedule: () => {
          scheduled++;
          return 0;
        },
      } as unknown as CorrelationScheduler,
    });

    const processed = await worker.runOnce();

    assertEquals(processed, 1);
    assertEquals(scheduled, 1);
    const event = repository.findById(id);
    assertEquals(event?.status, "completed");
    assertExists(event?.processedAt);
  });
});

Deno.test("worker não agenda correlação para eventos internos", async () => {
  await withDatabase(async (database, userId) => {
    const repository = new OutboxRepository(database.db);
    const config = loadConfig({});
    insertEvent(repository, userId, { type: "correlation.check" });

    let scheduled = 0;
    const worker = new EventWorker({
      db: database.db,
      config,
      logger,
      repository,
      processor: {
        process: () => Promise.resolve({ processed: true, toolCalls: 0, executed: 0 }),
      } as unknown as AiProcessor,
      correlations: {
        maybeSchedule: () => {
          scheduled++;
          return 0;
        },
      } as unknown as CorrelationScheduler,
    });

    await worker.runOnce();
    assertEquals(scheduled, 0);
  });
});

Deno.test("worker reagenda falha com backoff", async () => {
  await withDatabase(async (database, userId) => {
    const repository = new OutboxRepository(database.db);
    const config = loadConfig({ AI_MAX_RETRIES: "3" });
    const id = insertEvent(repository, userId);

    const worker = new EventWorker({
      db: database.db,
      config,
      logger,
      repository,
      processor: {
        process: () => Promise.reject(new Error("provider fora do ar")),
      } as unknown as AiProcessor,
      correlations: {
        maybeSchedule: () => 0,
      } as unknown as CorrelationScheduler,
    });

    const processed = await worker.runOnce();

    assertEquals(processed, 1);
    const event = repository.findById(id);
    assertEquals(event?.status, "pending");
    assertEquals(event?.attempts, 1);
    assertEquals(event?.lastError, "provider fora do ar");
    assertExists(event?.availableAt);
  });
});

Deno.test("worker envia para dead-letter quando as tentativas acabam", async () => {
  await withDatabase(async (database, userId) => {
    const repository = new OutboxRepository(database.db);
    const config = loadConfig({ AI_MAX_RETRIES: "0" });
    const id = insertEvent(repository, userId);

    const worker = new EventWorker({
      db: database.db,
      config,
      logger,
      repository,
      processor: {
        process: () => Promise.reject(new Error("falha definitiva")),
      } as unknown as AiProcessor,
      correlations: {
        maybeSchedule: () => 0,
      } as unknown as CorrelationScheduler,
    });

    await worker.runOnce();

    const event = repository.findById(id);
    assertEquals(event?.status, "failed");
    assertEquals(event?.attempts, 1);
    assertEquals(event?.lastError, "falha definitiva");
  });
});

Deno.test("worker processa no máximo o tamanho do lote", async () => {
  await withDatabase(async (database, userId) => {
    const repository = new OutboxRepository(database.db);
    const config = loadConfig({ AI_MAX_EVENTS_PER_BATCH: "2" });
    insertEvent(repository, userId);
    insertEvent(repository, userId);
    insertEvent(repository, userId);

    const worker = new EventWorker({
      db: database.db,
      config,
      logger,
      repository,
      processor: {
        process: () => Promise.resolve({ processed: true, toolCalls: 0, executed: 0 }),
      } as unknown as AiProcessor,
      correlations: {
        maybeSchedule: () => 0,
      } as unknown as CorrelationScheduler,
    });

    const processed = await worker.runOnce();

    assertEquals(processed, 2);
    assertEquals(repository.stats().completed, 2);
    assertEquals(repository.stats().pending, 1);
  });
});

Deno.test("transação publica evento apenas com IA ligada e opt-in", async () => {
  const testApp = await createTestApp({ env: AI_ENV });

  try {
    const client = new AuthTestClient(testApp.app);
    await client.bootstrapCsrf();
    const registered = await client.request("/api/v1/auth/register", {
      method: "POST",
      body: {
        name: "Ana",
        email: "ana@example.com",
        password: "senha-super-segura",
      },
    });
    assertEquals(registered.status, 201);

    const me = await client.request("/api/v1/me");
    const meBody = await me.json();
    assertEquals(meBody.data.user.preferences.aiEnabled, false);

    const accountResponse = await client.request("/api/v1/accounts", {
      method: "POST",
      body: { name: "Conta corrente", type: "checking" },
    });
    const account = (await accountResponse.json()).data.account;

    const before = await client.request("/api/v1/transactions", {
      method: "POST",
      body: {
        accountId: account.id,
        type: "expense",
        amountMinor: 1_500,
        description: "Mercado",
        transactionDate: "2026-11-05",
      },
    });
    assertEquals(before.status, 201);
    assertEquals(new OutboxRepository(testApp.database.db).stats().pending, 0);

    const optedIn = await client.request("/api/v1/me/preferences", {
      method: "PATCH",
      body: { aiEnabled: true },
    });
    const optedInBody = await optedIn.json();
    assertEquals(optedIn.status, 200);
    assertEquals(optedInBody.data.user.preferences.aiEnabled, true);

    const after = await client.request("/api/v1/transactions", {
      method: "POST",
      body: {
        accountId: account.id,
        type: "expense",
        amountMinor: 2_500,
        description: "Farmácia",
        transactionDate: "2026-11-05",
      },
    });
    assertEquals(after.status, 201);

    const outbox = new OutboxRepository(testApp.database.db);
    const stats = outbox.stats();
    assertEquals(stats.pending, 1);

    const event = testApp.database.db
      .prepare<
        [],
        { type: string; aggregate_type: string; payload: string }
      >("SELECT type, aggregate_type, payload FROM event_outbox LIMIT 1")
      .get();
    assertExists(event);
    assertEquals(event.type, "finance.transaction.created");
    assertEquals(event.aggregate_type, "transaction");
    assertEquals(JSON.parse(event.payload).amountMinor, 2_500);
  } finally {
    testApp.cleanup();
  }
});
