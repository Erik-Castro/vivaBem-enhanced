import { assertEquals, assertExists } from "@std/assert";
import { createTestApp, type TestApp } from "../helpers/app.ts";
import { AuthTestClient } from "../helpers/auth-client.ts";
import { todayUtc } from "../../src/shared/utils/date.ts";

const PASSWORD = "senha-super-segura";

async function register(app: TestApp["app"], email: string, name: string): Promise<AuthTestClient> {
  const client = new AuthTestClient(app);
  await client.bootstrapCsrf();

  const response = await client.request("/api/v1/auth/register", {
    method: "POST",
    body: { name, email, password: PASSWORD },
  });
  assertEquals(response.status, 201);

  return client;
}

async function invite(
  client: AuthTestClient,
  email: string,
): Promise<{ id: string; status: string }> {
  const response = await client.request("/api/v1/family/invite", {
    method: "POST",
    body: { email },
  });
  const body = await response.json();
  assertEquals(response.status, 201, JSON.stringify(body));
  return body.data.link;
}

Deno.test("rotas familiares exigem autenticação", async () => {
  const testApp = await createTestApp();

  try {
    for (const path of ["/api/v1/family", "/api/v1/family/summary"]) {
      const response = await testApp.app.request(path);
      assertEquals(response.status, 401);
      assertEquals((await response.json()).error.code, "UNAUTHORIZED");
    }

    const inviteResponse = await testApp.app.request("/api/v1/family/invite", {
      method: "POST",
    });
    // POST sem CSRF é barrado antes da autenticação.
    assertEquals(inviteResponse.status, 403);
    assertEquals((await inviteResponse.json()).error.code, "FORBIDDEN");
  } finally {
    testApp.cleanup();
  }
});

Deno.test("convite, aceite, resumo agregado e revogação", async () => {
  const testApp = await createTestApp();

  try {
    const ana = await register(testApp.app, "ana@example.com", "Ana");
    const bruno = await register(testApp.app, "bruno@example.com", "Bruno");

    const accountResponse = await ana.request("/api/v1/accounts", {
      method: "POST",
      body: { name: "Conta da Ana", type: "checking" },
    });
    const account = (await accountResponse.json()).data.account;
    const transactionResponse = await ana.request("/api/v1/transactions", {
      method: "POST",
      body: {
        accountId: account.id,
        type: "income",
        amountMinor: 100000,
        description: "Salário",
        transactionDate: todayUtc(),
      },
    });
    assertEquals(transactionResponse.status, 201);

    const link = await invite(ana, "bruno@example.com");
    assertEquals(link.status, "pending");

    const notifications = await bruno.request("/api/v1/notifications");
    const notificationsBody = await notifications.json();
    assertEquals(notifications.status, 200);
    assertEquals(notificationsBody.data.notifications.length, 1);
    assertEquals(notificationsBody.data.notifications[0].category, "family");
    assertEquals(notificationsBody.data.notifications[0].title, "Novo convite familiar");

    const incoming = await bruno.request("/api/v1/family");
    const incomingBody = await incoming.json();
    assertEquals(incomingBody.data.incoming.length, 1);
    assertEquals(incomingBody.data.incoming[0].role, "addressee");
    assertEquals(incomingBody.data.incoming[0].partner.email, "ana@example.com");

    const outgoing = await ana.request("/api/v1/family");
    const outgoingBody = await outgoing.json();
    assertEquals(outgoingBody.data.outgoing.length, 1);
    assertEquals(outgoingBody.data.outgoing[0].role, "requester");

    const beforeAccept = await bruno.request("/api/v1/family/summary");
    assertEquals(beforeAccept.status, 404);

    const accepted = await bruno.request(`/api/v1/family/${link.id}/accept`, {
      method: "POST",
    });
    const acceptedBody = await accepted.json();
    assertEquals(accepted.status, 200, JSON.stringify(acceptedBody));
    assertEquals(acceptedBody.data.link.status, "accepted");
    assertExists(acceptedBody.data.link.respondedAt);

    const acceptedNotification = await ana.request("/api/v1/notifications");
    const acceptedNotificationBody = await acceptedNotification.json();
    assertEquals(
      acceptedNotificationBody.data.notifications[0].title,
      "Convite familiar aceito",
    );

    const active = await ana.request("/api/v1/family");
    const activeBody = await active.json();
    assertEquals(activeBody.data.active.length, 1);
    assertEquals(activeBody.data.outgoing.length, 0);

    const summary = await bruno.request("/api/v1/family/summary");
    const summaryBody = await summary.json();
    assertEquals(summary.status, 200, JSON.stringify(summaryBody));
    assertEquals(summaryBody.data.partner.name, "Ana");
    assertEquals(summaryBody.data.counts.activeAccounts, 1);
    assertEquals(summaryBody.data.counts.habitLogs, 0);
    assertEquals(summaryBody.data.totals.length, 1);
    assertEquals(summaryBody.data.totals[0].currencyCode, "BRL");
    assertEquals(summaryBody.data.totals[0].incomeMinor, 100000);
    assertEquals(summaryBody.data.totals[0].expenseMinor, 0);
    assertEquals(summaryBody.data.totals[0].netMinor, 100000);
    assertEquals(summaryBody.data.totals[0].transactionCount, 1);

    const revoked = await ana.request(`/api/v1/family/${link.id}`, { method: "DELETE" });
    assertEquals(revoked.status, 200);
    assertEquals((await revoked.json()).data.revoked, true);

    const afterRevoke = await bruno.request("/api/v1/family/summary");
    assertEquals(afterRevoke.status, 404);

    const revokedNotification = await bruno.request("/api/v1/notifications");
    const revokedNotificationBody = await revokedNotification.json();
    assertEquals(
      revokedNotificationBody.data.notifications[0].title,
      "Vínculo familiar encerrado",
    );
  } finally {
    testApp.cleanup();
  }
});

Deno.test("recusa e novo convite reabrem o mesmo vínculo", async () => {
  const testApp = await createTestApp();

  try {
    const ana = await register(testApp.app, "ana@example.com", "Ana");
    const bruno = await register(testApp.app, "bruno@example.com", "Bruno");

    const link = await invite(ana, "bruno@example.com");

    const rejected = await bruno.request(`/api/v1/family/${link.id}/reject`, {
      method: "POST",
    });
    const rejectedBody = await rejected.json();
    assertEquals(rejected.status, 200);
    assertEquals(rejectedBody.data.link.status, "rejected");

    const afterReject = await ana.request("/api/v1/family");
    const afterRejectBody = await afterReject.json();
    assertEquals(afterRejectBody.data.outgoing.length, 0);
    assertEquals(afterRejectBody.data.active.length, 0);

    const again = await invite(ana, "bruno@example.com");
    assertEquals(again.id, link.id);
    assertEquals(again.status, "pending");

    const incoming = await bruno.request("/api/v1/family");
    const incomingBody = await incoming.json();
    assertEquals(incomingBody.data.incoming.length, 1);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("convite valida e-mail, vínculo existente e acesso cruzado", async () => {
  const testApp = await createTestApp();

  try {
    const ana = await register(testApp.app, "ana@example.com", "Ana");
    const bruno = await register(testApp.app, "bruno@example.com", "Bruno");
    const carla = await register(testApp.app, "carla@example.com", "Carla");

    const self = await ana.request("/api/v1/family/invite", {
      method: "POST",
      body: { email: "ana@example.com" },
    });
    assertEquals(self.status, 400);
    assertEquals((await self.json()).error.code, "VALIDATION_ERROR");

    const unknown = await ana.request("/api/v1/family/invite", {
      method: "POST",
      body: { email: "ninguem@example.com" },
    });
    assertEquals(unknown.status, 404);
    assertEquals((await unknown.json()).error.code, "NOT_FOUND");

    const link = await invite(ana, "bruno@example.com");

    const duplicated = await ana.request("/api/v1/family/invite", {
      method: "POST",
      body: { email: "bruno@example.com" },
    });
    assertEquals(duplicated.status, 409);
    assertEquals((await duplicated.json()).error.code, "CONFLICT");

    const crossAccess = await carla.request(`/api/v1/family/${link.id}/accept`, {
      method: "POST",
    });
    assertEquals(crossAccess.status, 404);

    const crossRevoke = await carla.request(`/api/v1/family/${link.id}`, {
      method: "DELETE",
    });
    assertEquals(crossRevoke.status, 404);

    const missing = await bruno.request("/api/v1/family/unknown/accept", { method: "POST" });
    assertEquals(missing.status, 404);
  } finally {
    testApp.cleanup();
  }
});
