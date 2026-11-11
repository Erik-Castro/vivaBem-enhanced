import { assertEquals, assertExists } from "@std/assert";
import { loadConfig, loadWorkerConfig, type WorkerConfig } from "../../src/config.ts";
import { createLogger } from "../../src/shared/logger/index.ts";
import type { AppDatabase } from "../../src/db/client.ts";
import { EventPublisher } from "../../src/events/event-publisher.ts";
import { OutboxRepository } from "../../src/events/outbox.repository.ts";
import { EventPayloadError } from "../../src/events/errors.ts";
import type { ClaimedEvent } from "../../src/events/events.types.ts";
import type { AiProcessor } from "../../src/ai/ai.processor.ts";
import type { CorrelationScheduler } from "../../src/ai/ai.correlation.ts";
import { WorkerRuntime } from "../../src/worker/runtime.ts";
import { InsightsRepository } from "../../src/modules/insights/insights.repository.ts";
import { NotificationsRepository } from "../../src/modules/notifications/notifications.repository.ts";
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

function workerConfig(overrides: Record<string, string> = {}): WorkerConfig {
  return loadWorkerConfig({
    WORKER_POLL_INTERVAL_MS: "50",
    WORKER_HEARTBEAT_MS: "2000",
    WORKER_LEASE_MS: "60000",
    WORKER_MAX_ATTEMPTS: "3",
    WORKER_CONCURRENCY: "1",
    WORKER_SHUTDOWN_GRACE_MS: "50",
    ...overrides,
  });
}

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

interface InsertOptions {
  readonly type?: Parameters<OutboxRepository["insert"]>[0]["type"];
  readonly priority?: number;
  readonly availableAt?: string;
  readonly payload?: Record<string, unknown>;
  readonly now?: string;
}

function insertEvent(
  repository: OutboxRepository,
  userId: string,
  overrides: InsertOptions = {},
): string {
  const now = overrides.now ?? new Date().toISOString();
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

function processor(
  process: (
    event: ClaimedEvent,
  ) => Promise<{ processed: boolean; toolCalls: number; executed: number }>,
): AiProcessor {
  return { process } as unknown as AiProcessor;
}

function correlations(maybeSchedule: () => number = () => 0): CorrelationScheduler {
  return { maybeSchedule } as unknown as CorrelationScheduler;
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

Deno.test("claim é atômico, prioriza e cria lease", async () => {
  await withDatabase((database, userId) => {
    const repository = new OutboxRepository(database.db);
    const low = insertEvent(repository, userId, { priority: 0 });
    const high = insertEvent(repository, userId, { priority: 10 });
    const now = new Date().toISOString();

    const first = repository.claimNext({ workerId: "worker-a", now, leaseMs: 60_000 });
    assertExists(first);
    assertEquals(first.id, high);
    assertEquals(first.workerId, "worker-a");
    assertEquals(typeof first.leaseToken, "string");
    assertExists(first.leaseExpiresAt);

    const second = repository.claimNext({ workerId: "worker-b", now, leaseMs: 60_000 });
    assertExists(second);
    assertEquals(second.id, low);

    assertEquals(repository.claimNext({ workerId: "worker-c", now, leaseMs: 60_000 }), null);

    const claimed = repository.findById(high);
    assertEquals(claimed?.status, "processing");
    assertEquals(claimed?.attempts, 1);
    assertEquals(claimed?.workerId, "worker-a");
  });
});

Deno.test("statsByType e retryingCount resumem a fila para operação", async () => {
  await withDatabase((database, userId) => {
    const repository = new OutboxRepository(database.db);
    const now = new Date().toISOString();
    const next = new Date(Date.now() + 5_000).toISOString();

    // Dois eventos do mesmo tipo e um de outro, todos pendentes.
    const first = insertEvent(repository, userId, {
      type: "finance.transaction.created",
      availableAt: now,
      now,
    });
    insertEvent(repository, userId, {
      type: "finance.transaction.created",
      availableAt: now,
      now,
    });
    insertEvent(repository, userId, { type: "habit.log.created", availableAt: now, now });

    assertEquals(repository.retryingCount(), 0);

    // O primeiro falha uma vez: volta para pending com attempts = 1.
    const claimed = repository.claimNext({ workerId: "worker-a", now, leaseMs: 60_000 });
    assertExists(claimed);
    assertEquals(
      repository.fail(claimed, {
        error: "timeout",
        now,
        nextAvailableAt: next,
        maxAttempts: 5,
      }),
      "retry",
    );

    assertEquals(repository.retryingCount(), 1);
    assertEquals(repository.statsByType("pending"), [
      { type: "finance.transaction.created", count: 2 },
      { type: "habit.log.created", count: 1 },
    ]);

    // Falha permanente vai para dead letter e aparece no recorte por tipo.
    const second = repository.claimNext({ workerId: "worker-a", now, leaseMs: 60_000 });
    assertExists(second);
    assertEquals(
      repository.fail(second, {
        error: "payload inválido",
        now,
        nextAvailableAt: next,
        maxAttempts: 5,
        permanent: true,
      }),
      "dead_letter",
    );

    assertEquals(repository.statsByType("dead_letter").length, 1);
    assertEquals(repository.statsByType("dead_letter")[0]?.count, 1);
    assertEquals(repository.findById(first)?.replayCount, 0);
  });
});

Deno.test("claim ignora eventos ainda não disponíveis", async () => {
  await withDatabase((database, userId) => {
    const repository = new OutboxRepository(database.db);
    insertEvent(repository, userId, {
      availableAt: new Date(Date.now() + 60_000).toISOString(),
    });

    assertEquals(
      repository.claimNext({
        workerId: "worker-a",
        now: new Date().toISOString(),
        leaseMs: 60_000,
      }),
      null,
    );
    assertEquals(repository.stats().pending, 1);
  });
});

Deno.test("complete só confirma a concessão corrente", async () => {
  await withDatabase((database, userId) => {
    const repository = new OutboxRepository(database.db);
    const id = insertEvent(repository, userId);
    const now = new Date().toISOString();

    const event = repository.claimNext({ workerId: "worker-a", now, leaseMs: 60_000 });
    assertExists(event);

    assertEquals(repository.complete(id, "worker-a", "token-errado", now), false);
    assertEquals(repository.complete(id, "worker-a", event.leaseToken, now), true);
    assertEquals(repository.findById(id)?.status, "completed");
    assertEquals(repository.findById(id)?.lockedAt, null);
    assertExists(repository.findById(id)?.processedAt);
  });
});

Deno.test("fail agenda retry com backoff e limite de tentativas", async () => {
  await withDatabase((database, userId) => {
    const repository = new OutboxRepository(database.db);
    const retryId = insertEvent(repository, userId);
    const deadId = insertEvent(repository, userId);
    const now = new Date().toISOString();
    const next = new Date(Date.now() + 5_000).toISOString();

    const retryEvent = repository.claimNext({ workerId: "worker-a", now, leaseMs: 60_000 });
    assertExists(retryEvent);
    assertEquals(
      repository.fail(retryEvent, {
        error: "provider indisponível",
        now,
        nextAvailableAt: next,
        maxAttempts: 3,
      }),
      "retry",
    );
    const retried = repository.findById(retryId);
    assertEquals(retried?.status, "pending");
    assertEquals(retried?.lastError, "provider indisponível");
    assertEquals(retried?.attempts, 1);
    assertEquals(retried?.lockedAt, null);
    assertEquals(retried?.availableAt, next);

    const deadEvent = repository.claimNext({ workerId: "worker-a", now, leaseMs: 60_000 });
    assertExists(deadEvent);
    assertEquals(
      repository.fail(deadEvent, {
        error: "erro definitivo",
        now,
        nextAvailableAt: next,
        maxAttempts: 1,
      }),
      "dead_letter",
    );
    assertEquals(repository.findById(deadId)?.status, "dead_letter");
    assertExists(repository.findById(deadId)?.processedAt);
  });
});

Deno.test("falha permanente vai direto para dead letter", async () => {
  await withDatabase((database, userId) => {
    const repository = new OutboxRepository(database.db);
    const id = insertEvent(repository, userId);
    const now = new Date().toISOString();

    const event = repository.claimNext({ workerId: "worker-a", now, leaseMs: 60_000 });
    assertExists(event);

    assertEquals(
      repository.fail(event, {
        error: "payload inválido",
        now,
        nextAvailableAt: now,
        maxAttempts: 10,
        permanent: true,
      }),
      "dead_letter",
    );
    assertEquals(repository.findById(id)?.status, "dead_letter");
  });
});

Deno.test("fail de concessão perdida não sobrescreve o evento", async () => {
  await withDatabase((database, userId) => {
    const repository = new OutboxRepository(database.db);
    const id = insertEvent(repository, userId);
    const now = new Date().toISOString();

    const event = repository.claimNext({ workerId: "worker-a", now, leaseMs: 60_000 });
    assertExists(event);

    database.db
      .prepare<[string]>("UPDATE event_outbox SET lease_token = 'outro' WHERE id = ?")
      .run(id);

    assertEquals(
      repository.fail(event, {
        error: "x",
        now,
        nextAvailableAt: now,
        maxAttempts: 10,
      }),
      "lost",
    );
    assertEquals(repository.findById(id)?.status, "processing");
  });
});

Deno.test("renewLease estende apenas a concessão corrente", async () => {
  await withDatabase((database, userId) => {
    const repository = new OutboxRepository(database.db);
    const id = insertEvent(repository, userId);
    const now = new Date().toISOString();

    const event = repository.claimNext({ workerId: "worker-a", now, leaseMs: 60_000 });
    assertExists(event);

    const extended = new Date(new Date(now).getTime() + 120_000).toISOString();
    assertEquals(
      repository.renewLease(id, "worker-a", "token-errado", now, 120_000),
      false,
    );
    assertEquals(repository.renewLease(id, "worker-a", event.leaseToken, now, 120_000), true);
    assertEquals(repository.findById(id)?.leaseExpiresAt, extended);
  });
});

Deno.test("recoverExpired devolve lease vencido e mata tentativas esgotadas", async () => {
  await withDatabase((database, userId) => {
    const repository = new OutboxRepository(database.db);
    const retryId = insertEvent(repository, userId);
    const deadId = insertEvent(repository, userId);
    const now = new Date().toISOString();

    const first = repository.claimNext({ workerId: "worker-a", now, leaseMs: 60_000 });
    const second = repository.claimNext({ workerId: "worker-a", now, leaseMs: 60_000 });
    assertExists(first);
    assertExists(second);

    const past = new Date(Date.now() - 60_000).toISOString();
    database.db
      .prepare<[string, string, string]>(
        "UPDATE event_outbox SET lease_expires_at = ? WHERE id IN (?, ?)",
      )
      .run(past, retryId, deadId);
    database.db
      .prepare<[number, string]>("UPDATE event_outbox SET attempts = ? WHERE id = ?")
      .run(3, deadId);

    const recovered = repository.recoverExpired({ now, maxAttempts: 3, leaseMs: 60_000 });

    assertEquals(recovered, { retried: 1, deadLettered: 1 });
    assertEquals(repository.findById(retryId)?.status, "pending");
    assertEquals(repository.findById(retryId)?.lastError, "lease expirado");
    assertEquals(repository.findById(deadId)?.status, "dead_letter");
  });
});

Deno.test("recoverExpired trata linha legada sem lease", async () => {
  await withDatabase((database, userId) => {
    const repository = new OutboxRepository(database.db);
    const id = insertEvent(repository, userId);
    const now = new Date().toISOString();

    assertExists(repository.claimNext({ workerId: "worker-a", now, leaseMs: 60_000 }));

    const past = new Date(Date.now() - 10 * 60_000).toISOString();
    database.db
      .prepare<[string, string]>(
        "UPDATE event_outbox SET lease_token = NULL, lease_expires_at = NULL, locked_at = ? WHERE id = ?",
      )
      .run(past, id);

    const recovered = repository.recoverExpired({ now, maxAttempts: 3, leaseMs: 60_000 });

    assertEquals(recovered.retried, 1);
    assertEquals(repository.findById(id)?.status, "pending");
  });
});

Deno.test("replay reenfileira eventos terminais e audita", async () => {
  await withDatabase((database, userId) => {
    const repository = new OutboxRepository(database.db);
    const id = insertEvent(repository, userId);
    const now = new Date().toISOString();

    const event = repository.claimNext({ workerId: "worker-a", now, leaseMs: 60_000 });
    assertExists(event);

    // Ainda em processamento: replay exige --force.
    assertEquals(repository.replay(id, now), "processing");

    repository.fail(event, {
      error: "falha definitiva",
      now,
      nextAvailableAt: now,
      maxAttempts: 1,
    });
    assertEquals(repository.findById(id)?.status, "dead_letter");

    assertEquals(repository.replay(id, now), "replayed");
    const replayed = repository.findById(id);
    assertEquals(replayed?.status, "pending");
    assertEquals(replayed?.attempts, 0);
    assertEquals(replayed?.replayCount, 1);
    assertEquals(replayed?.replayedAt, now);
    assertEquals(replayed?.processedAt, null);
    assertEquals(replayed?.lockedAt, null);

    assertEquals(repository.replay(uuidv7(), now), "not_found");
  });
});

Deno.test("replay recusa eventos não terminais sem force", async () => {
  await withDatabase((database, userId) => {
    const repository = new OutboxRepository(database.db);
    const id = insertEvent(repository, userId);
    const now = new Date().toISOString();

    assertEquals(repository.replay(id, now), "not_replayable");
    assertEquals(repository.replay(id, now, true), "replayed");
    assertEquals(repository.findById(id)?.status, "pending");
  });
});

Deno.test("stats e idade do pendente mais antigo", async () => {
  await withDatabase((database, userId) => {
    const repository = new OutboxRepository(database.db);
    const old = new Date(Date.now() - 120_000).toISOString();
    insertEvent(repository, userId, { now: old, availableAt: old });
    insertEvent(repository, userId);

    const stats = repository.stats();
    assertEquals(stats.pending, 2);
    assertEquals(stats.processing, 0);
    assertEquals(stats.completed, 0);
    assertEquals(stats.failed, 0);
    assertEquals(stats.deadLetter, 0);

    const age = repository.oldestPendingAgeSeconds(new Date().toISOString());
    assertEquals(age >= 120, true);
  });
});

Deno.test("hasActiveOfType detecta apenas eventos em andamento", async () => {
  await withDatabase((database, userId) => {
    const repository = new OutboxRepository(database.db);
    const id = insertEvent(repository, userId);

    assertEquals(repository.hasActiveOfType(userId, "finance.transaction.created"), true);

    const event = repository.claimNext({
      workerId: "worker-a",
      now: new Date().toISOString(),
      leaseMs: 60_000,
    });
    assertExists(event);
    repository.complete(id, event.workerId, event.leaseToken, new Date().toISOString());

    assertEquals(repository.hasActiveOfType(userId, "finance.transaction.created"), false);
    assertEquals(repository.hasActiveOfType(userId, "habit.log.created"), false);
  });
});

Deno.test("runtime completa o evento e agenda correlação", async () => {
  await withDatabase(async (database, userId) => {
    const repository = new OutboxRepository(database.db);
    const id = insertEvent(repository, userId);

    let scheduled = 0;
    const runtime = new WorkerRuntime({
      db: database.db,
      config: workerConfig(),
      logger,
      repository,
      processor: processor(() => Promise.resolve({ processed: true, toolCalls: 1, executed: 1 })),
      correlations: correlations(() => ++scheduled),
    });

    const processed = await runtime.runOnce();

    assertEquals(processed, 1);
    assertEquals(scheduled, 1);
    assertEquals(repository.findById(id)?.status, "completed");
    assertExists(repository.findById(id)?.processedAt);
  });
});

Deno.test("runtime não agenda correlação para eventos internos", async () => {
  await withDatabase(async (database, userId) => {
    const repository = new OutboxRepository(database.db);
    insertEvent(repository, userId, { type: "correlation.check", payload: { patternType: "x" } });

    let scheduled = 0;
    const runtime = new WorkerRuntime({
      db: database.db,
      config: workerConfig(),
      logger,
      repository,
      processor: processor(() => Promise.resolve({ processed: true, toolCalls: 0, executed: 0 })),
      correlations: correlations(() => ++scheduled),
    });

    await runtime.runOnce();
    assertEquals(scheduled, 0);
  });
});

Deno.test("runtime reagenda falha transitória com backoff", async () => {
  await withDatabase(async (database, userId) => {
    const repository = new OutboxRepository(database.db);
    const id = insertEvent(repository, userId);
    const startedAt = new Date();

    const runtime = new WorkerRuntime({
      db: database.db,
      config: workerConfig(),
      logger,
      repository,
      processor: processor(() => Promise.reject(new Error("provider fora do ar"))),
      correlations: correlations(),
      random: () => 0,
    });

    assertEquals(await runtime.runOnce(), 1);

    const event = repository.findById(id);
    assertEquals(event?.status, "pending");
    assertEquals(event?.attempts, 1);
    assertEquals(event?.lastError, "provider fora do ar");
    assertExists(event?.availableAt);
    assertEquals(new Date(event.availableAt).getTime() - startedAt.getTime() >= 5_000, true);
  });
});

Deno.test("runtime envia falha permanente direto para dead letter", async () => {
  await withDatabase(async (database, userId) => {
    const repository = new OutboxRepository(database.db);
    const id = insertEvent(repository, userId);

    const runtime = new WorkerRuntime({
      db: database.db,
      config: workerConfig({ WORKER_MAX_ATTEMPTS: "5" }),
      logger,
      repository,
      processor: processor(() => Promise.reject(new EventPayloadError("payload inválido"))),
      correlations: correlations(),
    });

    await runtime.runOnce();

    const event = repository.findById(id);
    assertEquals(event?.status, "dead_letter");
    assertEquals(event?.attempts, 1);
    assertEquals(event?.lastError, "payload inválido");
  });
});

Deno.test("runtime envia para dead letter quando as tentativas acabam", async () => {
  await withDatabase(async (database, userId) => {
    const repository = new OutboxRepository(database.db);
    const id = insertEvent(repository, userId);

    const runtime = new WorkerRuntime({
      db: database.db,
      config: workerConfig({ WORKER_MAX_ATTEMPTS: "1" }),
      logger,
      repository,
      processor: processor(() => Promise.reject(new Error("falha definitiva"))),
      correlations: correlations(),
    });

    await runtime.runOnce();

    const event = repository.findById(id);
    assertEquals(event?.status, "dead_letter");
    assertEquals(event?.attempts, 1);
    assertEquals(event?.lastError, "falha definitiva");
  });
});

Deno.test("runtime não confirma evento cujo lease foi perdido", async () => {
  await withDatabase(async (database, userId) => {
    const repository = new OutboxRepository(database.db);
    const id = insertEvent(repository, userId);

    const runtime = new WorkerRuntime({
      db: database.db,
      config: workerConfig(),
      logger,
      repository,
      processor: processor((event) => {
        // Outra instância recuperou o evento durante o processamento.
        database.db
          .prepare<[string]>("UPDATE event_outbox SET lease_token = 'outro' WHERE id = ?")
          .run(event.id);
        return Promise.resolve({ processed: true, toolCalls: 0, executed: 0 });
      }),
      correlations: correlations(),
    });

    await runtime.runOnce();

    const event = repository.findById(id);
    assertEquals(event?.status, "processing");
    assertEquals(event?.processedAt, null);
  });
});

Deno.test("runtime processa no máximo o tamanho do lote", async () => {
  await withDatabase(async (database, userId) => {
    const repository = new OutboxRepository(database.db);
    insertEvent(repository, userId);
    insertEvent(repository, userId);
    insertEvent(repository, userId);

    const runtime = new WorkerRuntime({
      db: database.db,
      config: workerConfig({ AI_MAX_EVENTS_PER_BATCH: "2" }),
      logger,
      repository,
      processor: processor(() => Promise.resolve({ processed: true, toolCalls: 0, executed: 0 })),
      correlations: correlations(),
    });

    assertEquals(await runtime.runOnce(), 2);
    assertEquals(repository.stats().completed, 2);
    assertEquals(repository.stats().pending, 1);
  });
});

Deno.test("runtime respeita a concorrência configurada", async () => {
  await withDatabase(async (database, userId) => {
    const repository = new OutboxRepository(database.db);
    insertEvent(repository, userId);
    insertEvent(repository, userId);

    let inFlight = 0;
    let maxInFlight = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const runtime = new WorkerRuntime({
      db: database.db,
      config: workerConfig({ WORKER_CONCURRENCY: "2", AI_MAX_EVENTS_PER_BATCH: "10" }),
      logger,
      repository,
      processor: processor(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        if (maxInFlight < 2) {
          await gate;
        } else {
          release();
        }
        inFlight--;
        return { processed: true, toolCalls: 0, executed: 0 };
      }),
      correlations: correlations(),
    });

    assertEquals(await runtime.runOnce(), 2);
    assertEquals(maxInFlight, 2);
    assertEquals(repository.stats().completed, 2);
  });
});

Deno.test("dedupe de insights e notificações usa a chave do evento", async () => {
  await withDatabase((database, userId) => {
    const insights = new InsightsRepository(database.db);
    const notifications = new NotificationsRepository(database.db);
    const now = new Date().toISOString();
    const record = {
      category: "finance" as const,
      severity: "low" as const,
      title: "Gasto atípico",
      message: "Mensagem",
      sourceEvent: "finance.transaction.created",
      confidence: 0.9,
      now,
      dedupeKey: "evento-1:Gasto atípico",
    };

    assertEquals(insights.createIfAbsent({ id: uuidv7(), userId, ...record }).created, true);
    assertEquals(insights.createIfAbsent({ id: uuidv7(), userId, ...record }).created, false);

    // Chave nula mantém o comportamento antigo: não deduplica.
    const noKey = { ...record, dedupeKey: null };
    assertEquals(insights.createIfAbsent({ id: uuidv7(), userId, ...noKey }).created, true);
    assertEquals(insights.createIfAbsent({ id: uuidv7(), userId, ...noKey }).created, true);

    const notification = {
      title: "Alerta",
      message: "Mensagem",
      category: "finance" as const,
      severity: "high" as const,
      link: null,
      now,
      dedupeKey: "evento-1:Alerta",
    };
    assertEquals(
      notifications.createIfAbsent({ id: uuidv7(), userId, ...notification }).created,
      true,
    );
    assertEquals(
      notifications.createIfAbsent({ id: uuidv7(), userId, ...notification }).created,
      false,
    );
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
