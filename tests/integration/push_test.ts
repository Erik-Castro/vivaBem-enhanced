import { assert, assertEquals } from "@std/assert";
import { exportVapidKeys, generateVapidKeys } from "@negrel/webpush";
import { createTestApp, type TestApp } from "../helpers/app.ts";
import { AuthTestClient } from "../helpers/auth-client.ts";
import { createTestDatabase } from "../helpers/db.ts";
import { loadConfig } from "../../src/config.ts";
import type { AppDatabase } from "../../src/db/client.ts";
import { base64UrlDecode, base64UrlEncode } from "../../src/shared/crypto/tokens.ts";
import { runMaintenance } from "../../src/db/maintenance.ts";
import { createLogger } from "../../src/shared/logger/index.ts";
import { NotificationsPushRepository } from "../../src/modules/notifications/notifications.push.repository.ts";
import { PushDispatcher } from "../../src/modules/notifications/notifications.push.dispatcher.ts";
import type {
  PushSender,
  PushTarget,
} from "../../src/modules/notifications/notifications.push.sender.ts";
import type { PushPayload } from "../../src/modules/notifications/notifications.push.types.ts";

const PASSWORD = "senha-super-segura";
const VAPID = await generateVapidKeys({ extractable: true });
const EXPORTED_VAPID = await exportVapidKeys(VAPID);

const PUSH_ENV = {
  PUSH_ENABLED: "true",
  PUSH_VAPID_PUBLIC_KEY: JSON.stringify(EXPORTED_VAPID.publicKey),
  PUSH_VAPID_PRIVATE_KEY: JSON.stringify(EXPORTED_VAPID.privateKey),
  PUSH_VAPID_SUBJECT: "mailto:test@vivabem.local",
  PUSH_ENDPOINT_HOSTS: "example.com",
} satisfies Record<string, string>;

const USER_ID = "01920000-0000-7000-8000-0000000000a1";
const OTHER_USER_ID = "01920000-0000-7000-8000-0000000000a2";
const NOW = new Date("2026-11-13T12:00:00.000Z");

function fakePoint(): string {
  const bytes = new Uint8Array(65);
  bytes[0] = 4;
  bytes.fill(7, 1);
  return base64UrlEncode(bytes);
}

function subscriptionBody(endpoint: string) {
  return {
    endpoint,
    keys: {
      p256dh: fakePoint(),
      auth: base64UrlEncode(new Uint8Array(16).fill(3)),
    },
  };
}

async function register(app: TestApp["app"], email: string): Promise<AuthTestClient> {
  const client = new AuthTestClient(app);
  await client.bootstrapCsrf();
  const response = await client.request("/api/v1/auth/register", {
    method: "POST",
    body: { name: "Ana", email, password: PASSWORD },
  });
  assertEquals(response.status, 201);
  return client;
}

class GoneError extends Error {}

/** Sender falso: registra entregas e simula endpoints mortos ou indisponíveis. */
class FakeSender implements PushSender {
  readonly sent: Array<{ target: PushTarget; payload: PushPayload }> = [];
  readonly goneEndpoints: Set<string>;
  failAll: boolean;

  constructor(options: { gone?: string[]; failAll?: boolean } = {}) {
    this.goneEndpoints = new Set(options.gone ?? []);
    this.failAll = options.failAll ?? false;
  }

  send(target: PushTarget, payload: PushPayload): Promise<void> {
    if (this.goneEndpoints.has(target.endpoint)) {
      throw new GoneError("assinatura expirada");
    }
    if (this.failAll) {
      throw new Error("serviço de push indisponível");
    }
    this.sent.push({ target, payload });
    return Promise.resolve();
  }

  isGone(error: unknown): boolean {
    return error instanceof GoneError;
  }
}

function seedUser(db: AppDatabase, id: string, name: string): void {
  db.prepare(
    `INSERT INTO user_profiles (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
  ).run(id, name, NOW.toISOString(), NOW.toISOString());
}

function seedNotification(db: AppDatabase, id: string, userId: string): void {
  db.prepare(
    `INSERT INTO notifications (
       id, user_id, title, message, category, severity, link, is_read, created_at, push_state
     ) VALUES (?, ?, ?, ?, 'finance', 'medium', '/dashboard', 0, ?, 'pending')`,
  ).run(
    id,
    userId,
    "Orçamento estourado",
    "Você passou do limite de alimentação.",
    NOW.toISOString(),
  );
}

function notificationState(
  db: AppDatabase,
  id: string,
): { push_state: string; push_attempts: number; push_last_error: string | null } {
  const row = db
    .prepare<
      [string],
      { push_state: string; push_attempts: number; push_last_error: string | null }
    >("SELECT push_state, push_attempts, push_last_error FROM notifications WHERE id = ?")
    .get(id);
  assert(row !== undefined);
  return row;
}

function createDispatcher(db: AppDatabase, sender: PushSender): PushDispatcher {
  const config = loadConfig(PUSH_ENV);
  return new PushDispatcher({
    repository: new NotificationsPushRepository(db),
    sender,
    config: config.push,
    logger: createLogger({ level: "error", silent: true }),
    now: () => NOW,
  });
}

Deno.test("push desabilitado expõe chave nula e recusa inscrição", async () => {
  const app = await createTestApp();

  try {
    const client = await register(app.app, "push-off@example.com");

    const keyResponse = await client.request("/api/v1/notifications/push/key");
    assertEquals(keyResponse.status, 200);
    const key = await keyResponse.json();
    assertEquals(key.data, { enabled: false, publicKey: null });

    const subscribe = await client.request("/api/v1/notifications/push/subscriptions", {
      method: "POST",
      body: subscriptionBody("https://push.example.com/off"),
    });
    assertEquals(subscribe.status, 503);
    const body = await subscribe.json();
    assertEquals(body.error.code, "PUSH_DISABLED");
  } finally {
    app.cleanup();
  }
});

Deno.test("chave pública é o ponto não comprimido da chave VAPID", async () => {
  const app = await createTestApp({ env: PUSH_ENV });

  try {
    const client = await register(app.app, "push-key@example.com");
    const response = await client.request("/api/v1/notifications/push/key");
    assertEquals(response.status, 200);

    const body = await response.json();
    assertEquals(body.data.enabled, true);

    const point = base64UrlDecode(body.data.publicKey);
    assertEquals(point.length, 65);
    assertEquals(point[0], 4);

    const jwk = JSON.parse(PUSH_ENV.PUSH_VAPID_PUBLIC_KEY) as { x: string; y: string };
    assertEquals(point.slice(1, 33), base64UrlDecode(jwk.x));
    assertEquals(point.slice(33, 65), base64UrlDecode(jwk.y));
  } finally {
    app.cleanup();
  }
});

Deno.test("inscrição lista, reatribui o endpoint e revoga", async () => {
  const app = await createTestApp({ env: PUSH_ENV });

  try {
    const ana = await register(app.app, "push-ana@example.com");
    const bruno = await register(app.app, "push-bruno@example.com");
    const endpoint = "https://push.example.com/shared-device";

    const subscribed = await ana.request("/api/v1/notifications/push/subscriptions", {
      method: "POST",
      body: subscriptionBody(endpoint),
    });
    assertEquals(subscribed.status, 201);

    const anaList = await (await ana.request("/api/v1/notifications/push/subscriptions")).json();
    assertEquals(anaList.data.subscriptions.length, 1);
    assertEquals(anaList.data.subscriptions[0].endpoint, endpoint);

    // O mesmo navegador entra com outra conta: a assinatura viva muda de dono.
    const reassigned = await bruno.request("/api/v1/notifications/push/subscriptions", {
      method: "POST",
      body: subscriptionBody(endpoint),
    });
    assertEquals(reassigned.status, 201);

    const anaAfter = await (await ana.request("/api/v1/notifications/push/subscriptions")).json();
    assertEquals(anaAfter.data.subscriptions, []);

    const brunoList = await (await bruno.request("/api/v1/notifications/push/subscriptions"))
      .json();
    assertEquals(brunoList.data.subscriptions.length, 1);

    const revoked = await bruno.request("/api/v1/notifications/push/subscriptions", {
      method: "DELETE",
      body: { endpoint },
    });
    assertEquals(revoked.status, 200);

    const again = await bruno.request("/api/v1/notifications/push/subscriptions", {
      method: "DELETE",
      body: { endpoint },
    });
    assertEquals(again.status, 404);
  } finally {
    app.cleanup();
  }
});

Deno.test("assinatura de outro usuário não pode ser revogada", async () => {
  const app = await createTestApp({ env: PUSH_ENV });

  try {
    const ana = await register(app.app, "push-owner@example.com");
    const bruno = await register(app.app, "push-intruder@example.com");
    const endpoint = "https://push.example.com/ana-device";

    await ana.request("/api/v1/notifications/push/subscriptions", {
      method: "POST",
      body: subscriptionBody(endpoint),
    });

    const response = await bruno.request("/api/v1/notifications/push/subscriptions", {
      method: "DELETE",
      body: { endpoint },
    });
    assertEquals(response.status, 404);

    const list = await (await ana.request("/api/v1/notifications/push/subscriptions")).json();
    assertEquals(list.data.subscriptions.length, 1);
  } finally {
    app.cleanup();
  }
});

Deno.test("assinatura inválida é rejeitada na borda", async () => {
  const app = await createTestApp({ env: PUSH_ENV });

  try {
    const client = await register(app.app, "push-invalid@example.com");
    const response = await client.request("/api/v1/notifications/push/subscriptions", {
      method: "POST",
      body: {
        endpoint: "https://push.example.com/broken",
        keys: { p256dh: "nao-e-um-ponto", auth: "curto" },
      },
    });

    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error.code, "VALIDATION_ERROR");
  } finally {
    app.cleanup();
  }
});

Deno.test("notificação de teste entra na fila e aparece na central", async () => {
  const app = await createTestApp({ env: PUSH_ENV });

  try {
    const client = await register(app.app, "push-test@example.com");
    const endpoint = "https://push.example.com/test-device";

    const noDevice = await client.request("/api/v1/notifications/push/test", { method: "POST" });
    assertEquals(noDevice.status, 409);

    await client.request("/api/v1/notifications/push/subscriptions", {
      method: "POST",
      body: subscriptionBody(endpoint),
    });

    const response = await client.request("/api/v1/notifications/push/test", { method: "POST" });
    assertEquals(response.status, 202);
    const body = await response.json();

    const row = notificationState(app.database.db, body.data.notificationId);
    assertEquals(row.push_state, "pending");

    const list = await (await client.request("/api/v1/notifications")).json();
    assertEquals(list.data.notifications[0].id, body.data.notificationId);
  } finally {
    app.cleanup();
  }
});

Deno.test("dispatcher entrega para todos os dispositivos e não repete", async () => {
  const database = await createTestDatabase();

  try {
    seedUser(database.db, USER_ID, "Ana");
    seedNotification(database.db, "notification-1", USER_ID);

    const repository = new NotificationsPushRepository(database.db);
    for (const suffix of ["a", "b"]) {
      repository.upsert({
        id: `subscription-${suffix}`,
        userId: USER_ID,
        endpoint: `https://push.example.com/${suffix}`,
        p256dh: fakePoint(),
        auth: base64UrlEncode(new Uint8Array(16).fill(3)),
        userAgent: "test",
        now: NOW.toISOString(),
      });
    }

    const sender = new FakeSender();
    const dispatcher = createDispatcher(database.db, sender);

    const first = await dispatcher.runOnce();
    assertEquals(first, { claimed: 1, sent: 1, skipped: 0, failed: 0, revoked: 0 });
    assertEquals(sender.sent.length, 2);
    assertEquals(sender.sent[0]!.payload.title, "Orçamento estourado");

    const state = notificationState(database.db, "notification-1");
    assertEquals(state.push_state, "sent");
    assertEquals(state.push_attempts, 1);

    const second = await dispatcher.runOnce();
    assertEquals(second.claimed, 0);
    assertEquals(sender.sent.length, 2);
  } finally {
    database.cleanup();
  }
});

Deno.test("assinatura expirada é revogada e a notificação vira skipped", async () => {
  const database = await createTestDatabase();

  try {
    seedUser(database.db, USER_ID, "Ana");
    seedNotification(database.db, "notification-gone", USER_ID);

    const repository = new NotificationsPushRepository(database.db);
    const endpoint = "https://push.example.com/gone";
    repository.upsert({
      id: "subscription-gone",
      userId: USER_ID,
      endpoint,
      p256dh: fakePoint(),
      auth: base64UrlEncode(new Uint8Array(16).fill(3)),
      userAgent: null,
      now: NOW.toISOString(),
    });

    const dispatcher = createDispatcher(database.db, new FakeSender({ gone: [endpoint] }));
    const result = await dispatcher.runOnce();

    assertEquals(result, { claimed: 1, sent: 0, skipped: 1, failed: 0, revoked: 1 });
    assertEquals(repository.listActiveByUser(USER_ID).length, 0);
    assertEquals(notificationState(database.db, "notification-gone").push_state, "skipped");
  } finally {
    database.cleanup();
  }
});

Deno.test("falha transitória volta para a fila até esgotar as tentativas", async () => {
  const database = await createTestDatabase();

  try {
    seedUser(database.db, USER_ID, "Ana");
    seedNotification(database.db, "notification-retry", USER_ID);

    const repository = new NotificationsPushRepository(database.db);
    repository.upsert({
      id: "subscription-retry",
      userId: USER_ID,
      endpoint: "https://push.example.com/retry",
      p256dh: fakePoint(),
      auth: base64UrlEncode(new Uint8Array(16).fill(3)),
      userAgent: null,
      now: NOW.toISOString(),
    });

    const dispatcher = createDispatcher(database.db, new FakeSender({ failAll: true }));

    const first = await dispatcher.runOnce();
    assertEquals(first.failed, 1);
    const retryState = notificationState(database.db, "notification-retry");
    assertEquals(retryState.push_state, "pending");
    assertEquals(retryState.push_last_error, "serviço de push indisponível");

    await dispatcher.runOnce();
    await dispatcher.runOnce();

    const finalState = notificationState(database.db, "notification-retry");
    assertEquals(finalState.push_state, "failed");
    assertEquals(finalState.push_attempts, 3);

    const exhausted = await dispatcher.runOnce();
    assertEquals(exhausted.claimed, 0);
  } finally {
    database.cleanup();
  }
});

Deno.test("claim é exclusivo enquanto o lease está válido", async () => {
  const database = await createTestDatabase();

  try {
    seedUser(database.db, USER_ID, "Ana");
    seedNotification(database.db, "notification-claim", USER_ID);

    const repository = new NotificationsPushRepository(database.db);
    const now = "2026-11-13T12:00:00.000Z";
    const request = { now, leaseMs: 60_000, limit: 10 };

    const first = repository.claimPending(request);
    assertEquals(first.map((item) => item.id), ["notification-claim"]);
    assertEquals(first[0]!.attempts, 1);

    // Outro worker não enxerga a linha enquanto o lease vale.
    assertEquals(repository.claimPending(request), []);

    const afterLease = repository.claimPending({
      now: "2026-11-13T12:01:01.000Z",
      leaseMs: 60_000,
      limit: 10,
    });
    assertEquals(afterLease.map((item) => item.id), ["notification-claim"]);
    assertEquals(afterLease[0]!.attempts, 2);
  } finally {
    database.cleanup();
  }
});

Deno.test("manutenção remove assinaturas revogadas antigas e preserva as vivas", async () => {
  const database = await createTestDatabase();

  try {
    seedUser(database.db, USER_ID, "Ana");

    const repository = new NotificationsPushRepository(database.db);
    const now = NOW.toISOString();
    for (
      const [id, endpoint] of [["old", "https://push.example.com/old"], [
        "live",
        "https://push.example.com/live",
      ]] as const
    ) {
      repository.upsert({
        id: `subscription-${id}`,
        userId: USER_ID,
        endpoint,
        p256dh: fakePoint(),
        auth: base64UrlEncode(new Uint8Array(16).fill(3)),
        userAgent: null,
        now,
      });
    }

    repository.revokeById("subscription-old", now);
    const result = runMaintenance(database.db, {
      now: new Date("2026-12-20T12:00:00.000Z"),
    });

    assertEquals(result.revokedPushSubscriptions, 1);
    assertEquals(repository.listActiveByUser(USER_ID).length, 1);
  } finally {
    database.cleanup();
  }
});

Deno.test("notificação de outro usuário não é entregue por engano", async () => {
  const database = await createTestDatabase();

  try {
    seedUser(database.db, USER_ID, "Ana");
    seedUser(database.db, OTHER_USER_ID, "Bruno");
    seedNotification(database.db, "notification-bruno", OTHER_USER_ID);

    const repository = new NotificationsPushRepository(database.db);
    repository.upsert({
      id: "subscription-ana",
      userId: USER_ID,
      endpoint: "https://push.example.com/ana",
      p256dh: fakePoint(),
      auth: base64UrlEncode(new Uint8Array(16).fill(3)),
      userAgent: null,
      now: NOW.toISOString(),
    });

    const sender = new FakeSender();
    const dispatcher = createDispatcher(database.db, sender);
    const result = await dispatcher.runOnce();

    // O Bruno não tem dispositivo: nada é entregue no endpoint da Ana.
    assertEquals(result, { claimed: 1, sent: 0, skipped: 1, failed: 0, revoked: 0 });
    assertEquals(sender.sent.length, 0);
    assertEquals(notificationState(database.db, "notification-bruno").push_state, "skipped");
  } finally {
    database.cleanup();
  }
});

Deno.test("endpoint http:// é rejeitado na inscrição", async () => {
  const app = await createTestApp({ env: PUSH_ENV });

  try {
    const client = await register(app.app, "push-http@example.com");
    const response = await client.request("/api/v1/notifications/push/subscriptions", {
      method: "POST",
      body: subscriptionBody("http://push.example.com/device"),
    });

    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error.code, "VALIDATION_ERROR");
    assertEquals(
      body.error.details.some((d: { path: string; message: string }) =>
        d.path === "endpoint" && d.message.includes("https")
      ),
      true,
    );
  } finally {
    app.cleanup();
  }
});

Deno.test("endpoint com IP literal é rejeitado na inscrição", async () => {
  const app = await createTestApp({ env: PUSH_ENV });

  try {
    const client = await register(app.app, "push-ip@example.com");
    const response = await client.request("/api/v1/notifications/push/subscriptions", {
      method: "POST",
      body: subscriptionBody("https://192.168.1.50/device"),
    });

    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error.code, "VALIDATION_ERROR");
  } finally {
    app.cleanup();
  }
});

Deno.test("endpoint link-local (169.254.x.x) é rejeitado", async () => {
  const app = await createTestApp({ env: PUSH_ENV });

  try {
    const client = await register(app.app, "push-linklocal@example.com");
    const response = await client.request("/api/v1/notifications/push/subscriptions", {
      method: "POST",
      body: subscriptionBody("https://169.254.169.254/latest/meta-data/"),
    });

    assertEquals(response.status, 400);
  } finally {
    app.cleanup();
  }
});

Deno.test("endpoint localhost é rejeitado", async () => {
  const app = await createTestApp({ env: PUSH_ENV });

  try {
    const client = await register(app.app, "push-localhost@example.com");
    const response = await client.request("/api/v1/notifications/push/subscriptions", {
      method: "POST",
      body: subscriptionBody("https://localhost:8080/device"),
    });

    assertEquals(response.status, 400);
  } finally {
    app.cleanup();
  }
});

Deno.test("endpoint com credenciais na URL é rejeitado", async () => {
  const app = await createTestApp({ env: PUSH_ENV });

  try {
    const client = await register(app.app, "push-creds@example.com");
    const response = await client.request("/api/v1/notifications/push/subscriptions", {
      method: "POST",
      body: subscriptionBody("https://user:pass@push.example.com/device"),
    });

    assertEquals(response.status, 400);
  } finally {
    app.cleanup();
  }
});

Deno.test("host fora da allowlist é rejeitado na inscrição", async () => {
  const app = await createTestApp({ env: PUSH_ENV });

  try {
    const client = await register(app.app, "push-otherhost@example.com");
    const response = await client.request("/api/v1/notifications/push/subscriptions", {
      method: "POST",
      body: subscriptionBody("https://evil.com/device"),
    });

    assertEquals(response.status, 400);
  } finally {
    app.cleanup();
  }
});

Deno.test("subdomínio da allowlist é aceito", async () => {
  const app = await createTestApp({ env: PUSH_ENV });

  try {
    const client = await register(app.app, "push-subdomain@example.com");
    const response = await client.request("/api/v1/notifications/push/subscriptions", {
      method: "POST",
      body: subscriptionBody("https://updates.example.com/device"),
    });

    assertEquals(response.status, 201);
  } finally {
    app.cleanup();
  }
});

Deno.test("dispatcher revoga assinatura legado com host fora da allowlist", async () => {
  const database = await createTestDatabase();

  try {
    seedUser(database.db, USER_ID, "Ana");
    seedNotification(database.db, "notification-legacy", USER_ID);

    const repository = new NotificationsPushRepository(database.db);
    repository.upsert({
      id: "subscription-legacy",
      userId: USER_ID,
      endpoint: "https://evil.com/legacy",
      p256dh: fakePoint(),
      auth: base64UrlEncode(new Uint8Array(16).fill(3)),
      userAgent: "legacy",
      now: NOW.toISOString(),
    });

    const dispatcher = createDispatcher(database.db, new FakeSender());
    const result = await dispatcher.runOnce();

    assertEquals(result.revoked, 1);
    assertEquals(repository.listActiveByUser(USER_ID).length, 0);
  } finally {
    database.cleanup();
  }
});
