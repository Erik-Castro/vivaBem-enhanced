import { assertEquals, assertExists } from "@std/assert";
import { startTestServer, type TestServer } from "../helpers/server.ts";
import { HttpTestClient } from "../helpers/server.ts";
import { todayUtc } from "../../src/shared/utils/date.ts";

const PASSWORD = "senha-super-segura";

async function withServer(fn: (server: TestServer) => Promise<void>): Promise<void> {
  const server = await startTestServer();
  try {
    await fn(server);
  } finally {
    await server.close();
  }
}

Deno.test("E2E: fluxo completo de register, login, finanças, resumo e logout", async () => {
  await withServer(async (server) => {
    const client = new HttpTestClient(server);
    await client.bootstrapCsrf();

    const register = await client.request("/api/v1/auth/register", {
      method: "POST",
      body: { name: "Ana", email: "ana@example.com", password: PASSWORD },
    });
    assertEquals(register.status, 201, await register.text());

    const accessCookie = register.headers.getSetCookie()
      .find((cookie) => cookie.startsWith("vb_access="));
    const refreshCookie = register.headers.getSetCookie()
      .find((cookie) => cookie.startsWith("vb_refresh="));
    assertExists(accessCookie);
    assertExists(refreshCookie);
    assertEquals(accessCookie.includes("HttpOnly"), true);
    assertEquals(refreshCookie.includes("HttpOnly"), true);

    const accountResponse = await client.request("/api/v1/accounts", {
      method: "POST",
      body: { name: "Conta corrente", type: "checking" },
    });
    const accountBody = await accountResponse.json();
    assertEquals(accountResponse.status, 201, JSON.stringify(accountBody));

    const today = todayUtc();
    const transactionResponse = await client.request("/api/v1/transactions", {
      method: "POST",
      body: {
        accountId: accountBody.data.account.id,
        type: "expense",
        amountMinor: 4590,
        description: "Padaria",
        transactionDate: today,
        isCleared: true,
      },
    });
    assertEquals(transactionResponse.status, 201);

    const summaryResponse = await client.request(
      `/api/v1/transactions/summary?from=${today}&to=${today}`,
    );
    const summary = await summaryResponse.json();
    assertEquals(summaryResponse.status, 200, JSON.stringify(summary));
    assertEquals(summary.data.currencies[0].currencyCode, "BRL");
    assertEquals(summary.data.currencies[0].expenseMinor, 4590);
    assertEquals(summary.data.currencies[0].netMinor, -4590);

    const logout = await client.request("/api/v1/auth/logout", { method: "POST" });
    assertEquals(logout.status, 204);

    const afterLogout = await client.request("/api/v1/me");
    assertEquals(afterLogout.status, 401);
    assertEquals((await afterLogout.json()).error.code, "UNAUTHORIZED");

    await client.bootstrapCsrf();
    const login = await client.request("/api/v1/auth/login", {
      method: "POST",
      body: { email: "ana@example.com", password: PASSWORD },
    });
    assertEquals(login.status, 200, await login.text());

    const me = await client.request("/api/v1/me");
    const meBody = await me.json();
    assertEquals(me.status, 200);
    assertEquals(meBody.data.user.name, "Ana");

    const exportResponse = await client.request("/api/v1/export?format=json");
    const exported = await exportResponse.json();
    assertEquals(exportResponse.status, 200);
    assertEquals(exported.data.transactions.length, 1);
    assertEquals(exported.data.transactions[0].description, "Padaria");
  });
});

Deno.test("E2E: rotação de refresh token invalida o token anterior", async () => {
  await withServer(async (server) => {
    const client = new HttpTestClient(server);
    await client.bootstrapCsrf();

    const register = await client.request("/api/v1/auth/register", {
      method: "POST",
      body: { name: "Bruno", email: "bruno@example.com", password: PASSWORD },
    });
    assertEquals(register.status, 201);

    const firstRefresh = client.cookies.get("vb_refresh");
    assertExists(firstRefresh);

    const refresh = await client.request("/api/v1/auth/refresh", { method: "POST" });
    assertEquals(refresh.status, 200, await refresh.text());

    const secondRefresh = client.cookies.get("vb_refresh");
    assertExists(secondRefresh);
    assertEquals(secondRefresh === firstRefresh, false);

    // Reutilizar o token antigo deve revogar a família inteira.
    client.cookies.set("vb_refresh", firstRefresh);
    const reuse = await client.request("/api/v1/auth/refresh", { method: "POST" });
    assertEquals(reuse.status, 401);
    assertEquals((await reuse.json()).error.code, "UNAUTHORIZED");

    const afterReuse = await client.request("/api/v1/me");
    assertEquals(afterReuse.status, 401);
  });
});
