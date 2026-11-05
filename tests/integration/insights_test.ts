import { assertEquals, assertExists } from "@std/assert";
import { createTestApp, type TestApp } from "../helpers/app.ts";
import { AuthTestClient } from "../helpers/auth-client.ts";
import { InsightsRepository } from "../../src/modules/insights/insights.repository.ts";

const PASSWORD = "senha-super-segura";

async function register(
  app: TestApp["app"],
  email: string,
): Promise<{ client: AuthTestClient; userId: string }> {
  const client = new AuthTestClient(app);
  await client.bootstrapCsrf();

  const response = await client.request("/api/v1/auth/register", {
    method: "POST",
    body: { name: "Ana", email, password: PASSWORD },
  });
  assertEquals(response.status, 201);

  const me = await client.request("/api/v1/me");
  const body = await me.json();
  return { client, userId: body.data.user.id };
}

function createInsight(
  testApp: TestApp,
  userId: string,
  overrides: Partial<{
    category:
      | "finance"
      | "habit"
      | "security"
      | "investment"
      | "recommendation"
      | "family"
      | "correlation";
    severity: "low" | "medium" | "high" | "critical";
    title: string;
    message: string;
    confidence: number;
    createdAt: string;
  }> = {},
) {
  const repository = new InsightsRepository(testApp.database.db);
  return repository.create({
    id: crypto.randomUUID(),
    userId,
    category: overrides.category ?? "finance",
    severity: overrides.severity ?? "medium",
    title: overrides.title ?? "Gasto acima do padrão",
    message: overrides.message ?? "Você gastou 20% mais em mercado neste mês.",
    sourceEvent: "finance.transaction.created",
    confidence: overrides.confidence ?? 0.8,
    now: overrides.createdAt ?? new Date().toISOString(),
  });
}

Deno.test("rotas de insights exigem autenticação", async () => {
  const testApp = await createTestApp();

  try {
    const paths = [
      "/api/v1/insights",
      "/api/v1/insights/unread-count",
      "/api/v1/insights/search?q=teste",
    ];

    for (const path of paths) {
      const response = await testApp.app.request(path);
      const body = await response.json();
      assertEquals(response.status, 401);
      assertEquals(body.error.code, "UNAUTHORIZED");
    }
  } finally {
    testApp.cleanup();
  }
});

Deno.test("lista insights com filtros e paginação", async () => {
  const testApp = await createTestApp();

  try {
    const { client, userId } = await register(testApp.app, "ana@example.com");
    const first = createInsight(testApp, userId, {
      title: "Primeiro",
      createdAt: "2026-01-01T10:00:00.000Z",
    });
    const second = createInsight(testApp, userId, {
      category: "habit",
      title: "Segundo",
      createdAt: "2026-01-02T10:00:00.000Z",
    });
    createInsight(testApp, userId, {
      category: "habit",
      title: "Terceiro",
      createdAt: "2026-01-03T10:00:00.000Z",
    });

    const page = await client.request("/api/v1/insights?limit=2&offset=0");
    const pageBody = await page.json();

    assertEquals(page.status, 200);
    assertEquals(pageBody.data.insights.length, 2);
    assertEquals(pageBody.data.insights[0].title, "Terceiro");
    assertEquals(pageBody.meta.hasMore, true);

    const next = await client.request("/api/v1/insights?limit=2&offset=2");
    const nextBody = await next.json();
    assertEquals(nextBody.data.insights.length, 1);
    assertEquals(nextBody.data.insights[0].title, "Primeiro");
    assertEquals(nextBody.meta.hasMore, false);

    const habits = await client.request("/api/v1/insights?category=habit");
    const habitsBody = await habits.json();
    assertEquals(habitsBody.data.insights.length, 2);
    assertEquals(
      habitsBody.data.insights.every((insight: { category: string }) =>
        insight.category === "habit"
      ),
      true,
    );

    assertEquals(first.id.length > 0, true);
    assertEquals(second.isRead, false);

    const invalid = await client.request("/api/v1/insights?limit=0");
    assertEquals(invalid.status, 400);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("conta insights não lidos e marca um como lido", async () => {
  const testApp = await createTestApp();

  try {
    const { client, userId } = await register(testApp.app, "ana@example.com");
    const insight = createInsight(testApp, userId);
    createInsight(testApp, userId, { title: "Outro" });

    const unread = await client.request("/api/v1/insights/unread-count");
    const unreadBody = await unread.json();
    assertEquals(unreadBody.data.unread, 2);

    const marked = await client.request(`/api/v1/insights/${insight.id}/read`, {
      method: "PATCH",
    });
    const markedBody = await marked.json();
    assertEquals(marked.status, 200);
    assertEquals(markedBody.data.insight.isRead, true);

    const after = await client.request("/api/v1/insights/unread-count");
    assertEquals((await after.json()).data.unread, 1);

    const filtered = await client.request("/api/v1/insights?isRead=true");
    assertEquals((await filtered.json()).data.insights.length, 1);

    const missing = await client.request(
      `/api/v1/insights/${crypto.randomUUID()}/read`,
      { method: "PATCH" },
    );
    assertEquals(missing.status, 404);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("read-all atinge apenas os insights do usuário", async () => {
  const testApp = await createTestApp();

  try {
    const ana = await register(testApp.app, "ana@example.com");
    const bruno = await register(testApp.app, "bruno@example.com");
    createInsight(testApp, ana.userId);
    createInsight(testApp, ana.userId);
    const brunoInsight = createInsight(testApp, bruno.userId);

    const response = await ana.client.request("/api/v1/insights/read-all", {
      method: "POST",
    });
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(body.data.marked, 2);

    const brunoUnread = await bruno.client.request("/api/v1/insights/unread-count");
    assertEquals((await brunoUnread.json()).data.unread, 1);

    const repository = new InsightsRepository(testApp.database.db);
    assertEquals(repository.findById(bruno.userId, brunoInsight.id)?.isRead, false);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("acesso cruzado a insight retorna NOT_FOUND", async () => {
  const testApp = await createTestApp();

  try {
    const ana = await register(testApp.app, "ana@example.com");
    const bruno = await register(testApp.app, "bruno@example.com");
    const insight = createInsight(testApp, ana.userId);

    const read = await bruno.client.request(`/api/v1/insights/${insight.id}/read`, {
      method: "PATCH",
    });
    assertEquals(read.status, 404);
    assertEquals((await read.json()).error.code, "NOT_FOUND");

    const feedback = await bruno.client.request(
      `/api/v1/insights/${insight.id}/feedback`,
      { method: "POST", body: { rating: "helpful" } },
    );
    assertEquals(feedback.status, 404);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("feedback é gravado e atualizado por upsert", async () => {
  const testApp = await createTestApp();

  try {
    const { client, userId } = await register(testApp.app, "ana@example.com");
    const insight = createInsight(testApp, userId);

    const first = await client.request(`/api/v1/insights/${insight.id}/feedback`, {
      method: "POST",
      body: { rating: "helpful", comment: "Muito útil" },
    });
    const firstBody = await first.json();
    assertEquals(first.status, 200);
    assertEquals(firstBody.data.feedback.rating, "helpful");
    assertEquals(firstBody.data.feedback.comment, "Muito útil");
    const feedbackId = firstBody.data.feedback.id as string;

    const second = await client.request(`/api/v1/insights/${insight.id}/feedback`, {
      method: "POST",
      body: { rating: "not_helpful" },
    });
    const secondBody = await second.json();
    assertEquals(second.status, 200);
    assertEquals(secondBody.data.feedback.rating, "not_helpful");
    assertEquals(secondBody.data.feedback.comment, null);
    assertEquals(secondBody.data.feedback.id, feedbackId);

    const invalid = await client.request(`/api/v1/insights/${insight.id}/feedback`, {
      method: "POST",
      body: { rating: "excelente" },
    });
    assertEquals(invalid.status, 400);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("busca cai para texto quando não há embeddings", async () => {
  const testApp = await createTestApp();

  try {
    const ana = await register(testApp.app, "ana@example.com");
    const bruno = await register(testApp.app, "bruno@example.com");
    const matching = createInsight(testApp, ana.userId, {
      title: "Orçamento de mercado estourado",
      message: "Você passou do limite de alimentação.",
    });
    createInsight(testApp, ana.userId, {
      title: "Sequência de hábitos",
      message: "Você completou 10 dias seguidos.",
    });
    createInsight(testApp, bruno.userId, {
      title: "Orçamento de outra pessoa",
      message: "Não deve aparecer para Ana.",
    });

    const response = await ana.client.request(
      "/api/v1/insights/search?q=or%C3%A7amento",
    );
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(body.data.insights.length, 1);
    assertEquals(body.data.insights[0].id, matching.id);
    assertEquals(body.meta.query, "orçamento");

    const empty = await ana.client.request("/api/v1/insights/search?q=");
    assertEquals(empty.status, 400);

    const missing = await ana.client.request("/api/v1/insights/search?q=inexistente");
    const missingBody = await missing.json();
    assertEquals(missing.status, 200);
    assertEquals(missingBody.data.insights, []);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("insight inexistente no feedback retorna 404", async () => {
  const testApp = await createTestApp();

  try {
    const { client } = await register(testApp.app, "ana@example.com");

    const response = await client.request(
      `/api/v1/insights/${crypto.randomUUID()}/feedback`,
      { method: "POST", body: { rating: "helpful" } },
    );

    assertEquals(response.status, 404);
    assertExists((await response.json()).error.code);
  } finally {
    testApp.cleanup();
  }
});
