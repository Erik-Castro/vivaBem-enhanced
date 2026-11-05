import { assertEquals, assertExists } from "@std/assert";
import { createTestApp, type TestApp } from "../helpers/app.ts";
import { AuthTestClient } from "../helpers/auth-client.ts";

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

async function createAccount(
  client: AuthTestClient,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await client.request("/api/v1/accounts", { method: "POST", body });
  const json = await response.json();
  assertEquals(response.status, 201, JSON.stringify(json));
  return json.data.account;
}

async function createCategory(
  client: AuthTestClient,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await client.request("/api/v1/categories", { method: "POST", body });
  const json = await response.json();
  assertEquals(response.status, 201, JSON.stringify(json));
  return json.data.category;
}

async function createTransaction(
  client: AuthTestClient,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const response = await client.request("/api/v1/transactions", { method: "POST", body });
  const json = await response.json();
  assertEquals(response.status, 201, JSON.stringify(json));
  return json.data.transactions;
}

Deno.test("rotas financeiras exigem autenticação", async () => {
  const testApp = await createTestApp();

  try {
    for (const path of ["/api/v1/accounts", "/api/v1/categories", "/api/v1/transactions"]) {
      const response = await testApp.app.request(path);
      assertEquals(response.status, 401);
      assertEquals((await response.json()).error.code, "UNAUTHORIZED");
    }
  } finally {
    testApp.cleanup();
  }
});

Deno.test("contas usam a moeda base, listam e exigem nome único", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const account = await createAccount(client, { name: "Conta corrente", type: "checking" });

    assertEquals(account.currencyCode, "BRL");
    assertEquals(account.isActive, true);
    assertEquals(account.creditCard, null);

    const listResponse = await client.request("/api/v1/accounts");
    const listBody = await listResponse.json();
    assertEquals(listResponse.status, 200);
    assertEquals(listBody.data.accounts.length, 1);

    const duplicate = await client.request("/api/v1/accounts", {
      method: "POST",
      body: { name: "Conta corrente", type: "checking" },
    });
    assertEquals(duplicate.status, 409);
    assertEquals((await duplicate.json()).error.code, "CONFLICT");
  } finally {
    testApp.cleanup();
  }
});

Deno.test("cartão de crédito exige detalhes e expõe limite disponível", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);

    const missing = await client.request("/api/v1/accounts", {
      method: "POST",
      body: { name: "Cartão", type: "credit_card" },
    });
    assertEquals(missing.status, 400);

    const card = await createAccount(client, {
      name: "Cartão",
      type: "credit_card",
      creditCard: { closingDay: 10, dueDay: 20, limitMinor: 500000 },
    });

    assertEquals(card.creditCard, { closingDay: 10, dueDay: 20, limitMinor: 500000 });

    await createTransaction(client, {
      accountId: card.id,
      type: "expense",
      amountMinor: 150000,
      transactionDate: "2026-11-01",
    });

    const balanceResponse = await client.request(`/api/v1/accounts/${card.id}/balance`);
    const balanceBody = await balanceResponse.json();

    assertEquals(balanceResponse.status, 200);
    assertEquals(balanceBody.data.balance.balanceMinor, -150000);
    assertEquals(balanceBody.data.balance.availableCreditMinor, 350000);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("não permite trocar a moeda de conta com transações", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const account = await createAccount(client, { name: "Conta", type: "checking" });

    await createTransaction(client, {
      accountId: account.id,
      type: "income",
      amountMinor: 1000,
      transactionDate: "2026-11-01",
    });

    const response = await client.request(`/api/v1/accounts/${account.id}`, {
      method: "PATCH",
      body: { currencyCode: "USD" },
    });

    assertEquals(response.status, 409);
    assertEquals((await response.json()).error.code, "CONFLICT");
  } finally {
    testApp.cleanup();
  }
});

Deno.test("categorias formam árvore e validam tipo do pai", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const parent = await createCategory(client, { name: "Alimentação", type: "expense" });
    const child = await createCategory(client, {
      name: "Mercado",
      type: "expense",
      parentId: parent.id,
    });

    const mismatch = await client.request("/api/v1/categories", {
      method: "POST",
      body: { name: "Salário", type: "income", parentId: parent.id },
    });
    assertEquals(mismatch.status, 400);

    const treeResponse = await client.request("/api/v1/categories/tree");
    const treeBody = await treeResponse.json();

    assertEquals(treeResponse.status, 200);
    assertEquals(treeBody.data.categories.length, 1);
    assertEquals(treeBody.data.categories[0].id, parent.id);
    assertEquals(treeBody.data.categories[0].children[0].id, child.id);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("não permite mover categoria para dentro da própria subárvore", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const parent = await createCategory(client, { name: "Casa", type: "expense" });
    const child = await createCategory(client, {
      name: "Energia",
      type: "expense",
      parentId: parent.id,
    });

    const response = await client.request(`/api/v1/categories/${parent.id}`, {
      method: "PATCH",
      body: { parentId: child.id },
    });

    assertEquals(response.status, 409);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("excluir categoria desativa toda a subárvore", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const parent = await createCategory(client, { name: "Casa", type: "expense" });
    await createCategory(client, { name: "Água", type: "expense", parentId: parent.id });

    const response = await client.request(`/api/v1/categories/${parent.id}`, { method: "DELETE" });
    assertEquals(response.status, 204);

    const activeResponse = await client.request("/api/v1/categories");
    assertEquals((await activeResponse.json()).data.categories.length, 0);

    const allResponse = await client.request("/api/v1/categories?includeInactive=true");
    const all = (await allResponse.json()).data.categories;
    assertEquals(all.length, 2);
    assertEquals(all.every((category: { isActive: boolean }) => !category.isActive), true);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("transferência cria duas pernas assinadas e o saldo soma direto", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const checking = await createAccount(client, { name: "Corrente", type: "checking" });
    const savings = await createAccount(client, { name: "Poupança", type: "savings" });

    await createTransaction(client, {
      accountId: checking.id,
      type: "income",
      amountMinor: 100000,
      transactionDate: "2026-11-01",
    });

    const transferResponse = await client.request("/api/v1/transactions/transfer", {
      method: "POST",
      body: {
        fromAccountId: checking.id,
        toAccountId: savings.id,
        amountMinor: 30000,
        transactionDate: "2026-11-02",
      },
    });
    const transferBody = await transferResponse.json();

    assertEquals(transferResponse.status, 201);
    assertEquals(transferBody.data.from.amountMinor, -30000);
    assertEquals(transferBody.data.to.amountMinor, 30000);
    assertEquals(transferBody.data.from.transferGroupId, transferBody.data.to.transferGroupId);

    const checkingBalance = await client.request(`/api/v1/accounts/${checking.id}/balance`);
    const savingsBalance = await client.request(`/api/v1/accounts/${savings.id}/balance`);
    assertEquals((await checkingBalance.json()).data.balance.balanceMinor, 70000);
    assertEquals((await savingsBalance.json()).data.balance.balanceMinor, 30000);

    const summaryResponse = await client.request("/api/v1/transactions/summary");
    const summary = (await summaryResponse.json()).data;
    assertEquals(summary.currencies.length, 1);
    assertEquals(summary.currencies[0].incomeMinor, 100000);
    assertEquals(summary.currencies[0].expenseMinor, 0);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("transferência para a mesma conta é rejeitada", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const account = await createAccount(client, { name: "Conta", type: "checking" });

    const response = await client.request("/api/v1/transactions/transfer", {
      method: "POST",
      body: {
        fromAccountId: account.id,
        toAccountId: account.id,
        amountMinor: 1000,
        transactionDate: "2026-11-01",
      },
    });

    assertEquals(response.status, 400);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("parcelamento divide centavos restantes e ajusta o mês", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const card = await createAccount(client, {
      name: "Cartão",
      type: "credit_card",
      creditCard: { closingDay: 10, dueDay: 20, limitMinor: 1000000 },
    });

    const installments = await createTransaction(client, {
      accountId: card.id,
      type: "expense",
      amountMinor: 10000,
      transactionDate: "2026-01-31",
      installments: { totalInstallments: 3 },
    });

    assertEquals(installments.length, 3);
    assertEquals(installments.map((item) => item.amountMinor), [3334, 3333, 3333]);
    assertEquals(
      installments.map((item) => item.transactionDate),
      ["2026-01-31", "2026-02-28", "2026-03-31"],
    );
    assertEquals(
      installments.map((item) =>
        (item.installment as { installmentNumber: number }).installmentNumber
      ),
      [1, 2, 3],
    );

    const deleteResponse = await client.request(`/api/v1/transactions/${installments[0]?.id}`, {
      method: "DELETE",
    });
    assertEquals(deleteResponse.status, 204);

    const listResponse = await client.request(`/api/v1/accounts/${card.id}/transactions`);
    assertEquals((await listResponse.json()).data.transactions.length, 0);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("parcelamento exige cartão de crédito", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const account = await createAccount(client, { name: "Conta", type: "checking" });

    const response = await client.request("/api/v1/transactions", {
      method: "POST",
      body: {
        accountId: account.id,
        type: "expense",
        amountMinor: 10000,
        transactionDate: "2026-01-31",
        installments: { totalInstallments: 3 },
      },
    });

    assertEquals(response.status, 400);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("listagem pagina e resumo agrupa por categoria", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const account = await createAccount(client, { name: "Conta", type: "checking" });
    const category = await createCategory(client, { name: "Mercado", type: "expense" });

    for (const day of ["01", "02", "03"]) {
      await createTransaction(client, {
        accountId: account.id,
        categoryId: category.id,
        type: "expense",
        amountMinor: 1000,
        transactionDate: `2026-11-${day}`,
      });
    }

    const firstPage = await client.request("/api/v1/transactions?limit=2");
    const firstBody = await firstPage.json();
    assertEquals(firstBody.data.transactions.length, 2);
    assertEquals(firstBody.meta.hasMore, true);

    const secondPage = await client.request("/api/v1/transactions?limit=2&offset=2");
    const secondBody = await secondPage.json();
    assertEquals(secondBody.data.transactions.length, 1);
    assertEquals(secondBody.meta.hasMore, false);

    const summaryResponse = await client.request(
      `/api/v1/transactions/summary?from=2026-11-01&to=2026-11-30`,
    );
    const summary = (await summaryResponse.json()).data;

    assertEquals(summary.period.from, "2026-11-01");
    assertEquals(summary.currencies[0].expenseMinor, 3000);
    assertEquals(summary.currencies[0].byCategory[0].categoryId, category.id);
    assertEquals(summary.currencies[0].byCategory[0].amountMinor, 3000);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("compensar transação atualiza o saldo compensado", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const account = await createAccount(client, { name: "Conta", type: "checking" });
    const [transaction] = await createTransaction(client, {
      accountId: account.id,
      type: "income",
      amountMinor: 5000,
      transactionDate: "2026-11-01",
    });

    const before = await client.request(`/api/v1/accounts/${account.id}/balance`);
    assertEquals((await before.json()).data.balance.clearedBalanceMinor, 0);

    const clearResponse = await client.request(`/api/v1/transactions/${transaction?.id}/clear`, {
      method: "POST",
    });
    const cleared = await clearResponse.json();
    assertEquals(clearResponse.status, 200);
    assertEquals(cleared.data.transaction.isCleared, true);

    const after = await client.request(`/api/v1/accounts/${account.id}/balance`);
    assertEquals((await after.json()).data.balance.clearedBalanceMinor, 5000);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("dados financeiros são isolados por usuário", async () => {
  const testApp = await createTestApp();

  try {
    const ana = await register(testApp.app, "ana@example.com");
    const bruno = await register(testApp.app, "bruno@example.com");

    const account = await createAccount(ana, { name: "Conta da Ana", type: "checking" });
    const [transaction] = await createTransaction(ana, {
      accountId: account.id,
      type: "income",
      amountMinor: 1000,
      transactionDate: "2026-11-01",
    });

    const accountResponse = await bruno.request(`/api/v1/accounts/${account.id}`);
    assertEquals(accountResponse.status, 404);

    const transactionResponse = await bruno.request(`/api/v1/transactions/${transaction?.id}`);
    assertEquals(transactionResponse.status, 404);

    const listResponse = await bruno.request("/api/v1/transactions");
    assertEquals((await listResponse.json()).data.transactions.length, 0);

    const transferResponse = await bruno.request("/api/v1/transactions/transfer", {
      method: "POST",
      body: {
        fromAccountId: account.id,
        toAccountId: account.id,
        amountMinor: 1000,
        transactionDate: "2026-11-01",
      },
    });
    assertEquals(transferResponse.status, 404);
    assertExists(account.id);
  } finally {
    testApp.cleanup();
  }
});
