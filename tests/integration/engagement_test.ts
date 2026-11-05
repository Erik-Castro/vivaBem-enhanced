import { assert, assertEquals } from "@std/assert";
import { createTestApp, type TestApp } from "../helpers/app.ts";
import { AuthTestClient } from "../helpers/auth-client.ts";
import { seedAchievements } from "../../src/modules/achievements/achievements.seed.ts";
import { todayUtc } from "../../src/shared/utils/date.ts";

const PASSWORD = "senha-super-segura";

async function register(
  app: TestApp["app"],
  email = "engagement@example.com",
): Promise<AuthTestClient> {
  const client = new AuthTestClient(app);
  await client.bootstrapCsrf();

  const response = await client.request("/api/v1/auth/register", {
    method: "POST",
    body: { name: "Ana", email, password: PASSWORD },
  });
  assertEquals(response.status, 201);

  return client;
}

async function createAccount(
  client: AuthTestClient,
  body: Record<string, unknown> = { name: "Conta corrente", type: "checking" },
): Promise<Record<string, unknown>> {
  const response = await client.request("/api/v1/accounts", { method: "POST", body });
  const json = await response.json();
  assertEquals(response.status, 201, JSON.stringify(json));
  return json.data.account;
}

interface AchievementView {
  readonly id: string;
  readonly title: string;
  readonly isUnlocked: boolean;
  readonly currentProgress: number;
}

interface NotificationView {
  readonly id: string;
  readonly title: string;
  readonly isRead: boolean;
}

async function listProgress(client: AuthTestClient): Promise<{
  summary: { unlocked: number; total: number; points: number };
  achievements: AchievementView[];
}> {
  const response = await client.request("/api/v1/achievements/me/progress");
  const json = await response.json();
  assertEquals(response.status, 200, JSON.stringify(json));
  return json.data;
}

async function listNotifications(
  client: AuthTestClient,
  query = "",
): Promise<{ notifications: NotificationView[]; meta: { hasMore: boolean } }> {
  const response = await client.request(`/api/v1/notifications${query}`);
  const json = await response.json();
  assertEquals(response.status, 200, JSON.stringify(json));
  return json.data;
}

Deno.test("catálogo de conquistas é semeado de forma idempotente", async () => {
  const testApp = await createTestApp();

  try {
    const count = testApp.database.db
      .prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM achievements")
      .get()?.count;
    assertEquals(count, 352);

    const hidden = testApp.database.db
      .prepare<[], { count: number }>(
        "SELECT COUNT(*) AS count FROM achievements WHERE is_hidden = 1",
      )
      .get()?.count;
    assertEquals(hidden, 22);

    const reseeded = seedAchievements(testApp.database.db);
    assertEquals(reseeded.inserted, 0);
    assertEquals(reseeded.total, 352);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("rotas de engajamento exigem autenticação", async () => {
  const testApp = await createTestApp();

  try {
    for (
      const path of [
        "/api/v1/achievements",
        "/api/v1/achievements/me",
        "/api/v1/achievements/me/progress",
        "/api/v1/notifications",
        "/api/v1/notifications/unread-count",
      ]
    ) {
      const response = await testApp.app.request(path);
      assertEquals(response.status, 401, path);
    }
  } finally {
    testApp.cleanup();
  }
});

Deno.test("catálogo público esconde conquistas ocultas", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const response = await client.request("/api/v1/achievements");
    const json = await response.json();

    assertEquals(response.status, 200);
    assertEquals(json.data.achievements.length, 330);
    assert(
      json.data.achievements.every((entry: AchievementView & { isHidden: boolean }) =>
        entry.isHidden === false
      ),
    );
    assertEquals(json.data.achievements[0].title, "001. Olá, Mundo Financeiro");
  } finally {
    testApp.cleanup();
  }
});

Deno.test("mutação desbloqueia conquista e notifica apenas uma vez", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    await createAccount(client);

    const progress = await listProgress(client);
    const first = progress.achievements.find((entry) =>
      entry.title === "001. Olá, Mundo Financeiro"
    );
    assert(first !== undefined);
    assertEquals(first.isUnlocked, true);
    assertEquals(first.currentProgress >= 1, true);

    const notifications = await listNotifications(client);
    const unlockNotifications = notifications.notifications.filter(
      (entry) => entry.title === "Conquista desbloqueada: 001. Olá, Mundo Financeiro",
    );
    assertEquals(unlockNotifications.length, 1);

    // O segundo desbloqueio não existe: a conquista já foi desbloqueada.
    await createAccount(client, { name: "Poupança", type: "savings" });
    const after = await listNotifications(client, "?limit=100");
    const repeated = after.notifications.filter(
      (entry) => entry.title === "Conquista desbloqueada: 001. Olá, Mundo Financeiro",
    );
    assertEquals(repeated.length, 1);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("avaliação reage a transações e é idempotente entre leituras", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const account = await createAccount(client);

    const response = await client.request("/api/v1/transactions", {
      method: "POST",
      body: {
        accountId: account.id,
        type: "expense",
        amountMinor: 1500,
        transactionDate: todayUtc(),
        description: "Café",
      },
    });
    assertEquals(response.status, 201);

    const first = await listProgress(client);
    const expense = first.achievements.find((entry) => entry.title === "002. Quebrando o Gelo");
    assert(expense !== undefined);
    assertEquals(expense.isUnlocked, true);

    const second = await listProgress(client);
    assertEquals(second.summary.unlocked, first.summary.unlocked);
    assertEquals(second.summary.points, first.summary.points);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("notificações são escopadas por usuário e respeitam leitura", async () => {
  const testApp = await createTestApp();

  try {
    const ana = await register(testApp.app, "ana@example.com");
    await createAccount(ana);

    const bruno = await register(testApp.app, "bruno@example.com");

    const brunoNotifications = await listNotifications(bruno);
    assertEquals(brunoNotifications.notifications.length, 0);

    const anaNotifications = await listNotifications(ana);
    assert(anaNotifications.notifications.length > 0);
    const target = anaNotifications.notifications[0]!;

    const forbidden = await bruno.request(`/api/v1/notifications/${target.id}/read`, {
      method: "PATCH",
    });
    assertEquals(forbidden.status, 404);

    const before = await ana.request("/api/v1/notifications/unread-count");
    const beforeJson = await before.json();
    assertEquals(before.status, 200);
    assert(beforeJson.data.unread > 0);

    const marked = await ana.request(`/api/v1/notifications/${target.id}/read`, {
      method: "PATCH",
    });
    const markedJson = await marked.json();
    assertEquals(marked.status, 200);
    assertEquals(markedJson.data.notification.isRead, true);

    const after = await ana.request("/api/v1/notifications/unread-count");
    const afterJson = await after.json();
    assertEquals(afterJson.data.unread, beforeJson.data.unread - 1);

    const readAll = await ana.request("/api/v1/notifications/read-all", { method: "POST" });
    assertEquals(readAll.status, 200);

    const finalCount = await ana.request("/api/v1/notifications/unread-count");
    const finalJson = await finalCount.json();
    assertEquals(finalJson.data.unread, 0);

    const unreadOnly = await listNotifications(ana, "?isRead=false");
    assertEquals(unreadOnly.notifications.length, 0);
  } finally {
    testApp.cleanup();
  }
});
