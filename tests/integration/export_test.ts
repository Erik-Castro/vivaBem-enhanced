import { assertEquals } from "@std/assert";
import { createTestApp, type TestApp } from "../helpers/app.ts";
import { AuthTestClient } from "../helpers/auth-client.ts";
import { monthBounds, todayUtc } from "../../src/shared/utils/date.ts";

const PASSWORD = "senha-super-segura";

async function register(app: TestApp["app"], email = "ana@example.com"): Promise<AuthTestClient> {
  const client = new AuthTestClient(app);
  await client.bootstrapCsrf();

  const response = await client.request("/api/v1/auth/register", {
    method: "POST",
    body: { name: "Ana", email, password: PASSWORD },
  });
  assertEquals(response.status, 201);

  return client;
}

Deno.test("exportação exige autenticação", async () => {
  const testApp = await createTestApp();

  try {
    const response = await testApp.app.request("/api/v1/export?format=json");
    assertEquals(response.status, 401);
    assertEquals((await response.json()).error.code, "UNAUTHORIZED");
  } finally {
    testApp.cleanup();
  }
});

Deno.test("exporta JSON completo sem segredos e CSV de transações", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);

    const accountResponse = await client.request("/api/v1/accounts", {
      method: "POST",
      body: { name: "Conta corrente", type: "checking" },
    });
    const account = (await accountResponse.json()).data.account;

    const categoryResponse = await client.request("/api/v1/categories", {
      method: "POST",
      body: { name: "Mercado", type: "expense" },
    });
    const category = (await categoryResponse.json()).data.category;

    const today = todayUtc();
    const transactionResponse = await client.request("/api/v1/transactions", {
      method: "POST",
      body: {
        accountId: account.id,
        categoryId: category.id,
        type: "expense",
        amountMinor: 12345,
        description: 'Feira, "semanal"',
        transactionDate: today,
        isCleared: true,
      },
    });
    assertEquals(transactionResponse.status, 201);

    const jsonResponse = await client.request("/api/v1/export?format=json");
    const json = await jsonResponse.json();
    assertEquals(jsonResponse.status, 200, JSON.stringify(json));
    assertEquals(jsonResponse.headers.get("content-type")?.includes("application/json"), true);
    assertEquals(json.data.user.name, "Ana");
    assertEquals(json.data.credentials.email, "ana@example.com");
    assertEquals(json.data.accounts.length, 1);
    assertEquals(json.data.accounts[0].name, "Conta corrente");
    assertEquals(json.data.categories.length, 1);
    assertEquals(json.data.transactions.length, 1);
    assertEquals(json.data.transactions[0].amountMinor, 12345);
    assertEquals(json.data.transactions[0].transactionDate, today);
    assertEquals(json.data.sessions.length >= 1, true);
    assertEquals(typeof json.data.exportedAt, "string");

    const serialized = JSON.stringify(json);
    assertEquals(serialized.includes("passwordHash"), false);
    assertEquals(serialized.includes("refreshTokenHash"), false);
    assertEquals(serialized.includes("embedding"), false);

    const csvResponse = await client.request("/api/v1/export?format=csv");
    const csv = await csvResponse.text();
    assertEquals(csvResponse.status, 200);
    assertEquals(csvResponse.headers.get("content-type")?.includes("text/csv"), true);
    assertEquals(
      csvResponse.headers.get("content-disposition")?.includes("attachment; filename="),
      true,
    );

    const lines = csv.trim().split("\n");
    assertEquals(
      lines[0],
      "transaction_date,type,amount,amount_minor,currency,account,category,description," +
        "is_cleared,external_id,transfer_group_id,created_at",
    );
    assertEquals(lines.length, 2);
    assertEquals(
      lines[1],
      `${today},expense,123.45,12345,BRL,Conta corrente,Mercado,` +
        `"Feira, ""semanal""",true,,,${json.data.transactions[0].createdAt}`,
    );

    const month = monthBounds(today);
    assertEquals(month.from <= today && today <= month.to, true);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("exportação vazia devolve arrays e cabeçalho CSV", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);

    const jsonResponse = await client.request("/api/v1/export");
    const json = await jsonResponse.json();
    assertEquals(jsonResponse.status, 200);
    assertEquals(json.data.accounts.length, 0);
    assertEquals(json.data.transactions.length, 0);

    const csvResponse = await client.request("/api/v1/export?format=csv");
    const csv = await csvResponse.text();
    assertEquals(csvResponse.status, 200);
    assertEquals(csv.trim().split("\n").length, 1);
  } finally {
    testApp.cleanup();
  }
});
