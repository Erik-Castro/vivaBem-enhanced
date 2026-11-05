import { assertEquals } from "@std/assert";
import { createTestApp, type TestApp } from "../helpers/app.ts";
import { AuthTestClient } from "../helpers/auth-client.ts";
import { RecurringRepository } from "../../src/modules/recurring/recurring.repository.ts";
import { RecurringService } from "../../src/modules/recurring/recurring.service.ts";
import { TransactionsRepository } from "../../src/modules/transactions/transactions.repository.ts";
import { AccountsRepository } from "../../src/modules/accounts/accounts.repository.ts";
import { CategoriesRepository } from "../../src/modules/categories/categories.repository.ts";

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
  body: Record<string, unknown> = { name: "Conta corrente", type: "checking" },
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
): Promise<Record<string, unknown>> {
  const response = await client.request("/api/v1/transactions", { method: "POST", body });
  const json = await response.json();
  assertEquals(response.status, 201, JSON.stringify(json));
  return json.data.transactions[0];
}

Deno.test("rotas de planejamento exigem autenticação", async () => {
  const testApp = await createTestApp();

  try {
    for (
      const path of [
        "/api/v1/recurring",
        "/api/v1/recurring/upcoming",
        "/api/v1/budgets",
        "/api/v1/budgets/status",
        "/api/v1/goals",
      ]
    ) {
      const response = await testApp.app.request(path);
      assertEquals(response.status, 401, path);
      assertEquals((await response.json()).error.code, "UNAUTHORIZED");
    }
  } finally {
    testApp.cleanup();
  }
});

Deno.test("recorrência mensal mantém o dia-alvo e o run-now avança o agendamento", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const account = await createAccount(client);

    const createResponse = await client.request("/api/v1/recurring", {
      method: "POST",
      body: {
        accountId: account.id,
        type: "expense",
        amountMinor: 15000,
        description: "Aluguel",
        frequency: "monthly",
        dayOfMonth: 31,
        startDate: "2026-01-31",
      },
    });
    const created = await createResponse.json();

    assertEquals(createResponse.status, 201, JSON.stringify(created));
    assertEquals(created.data.recurring.nextOccurrence, "2026-01-31");
    assertEquals(created.data.recurring.dayOfMonth, 31);

    const recurringId = created.data.recurring.id;

    const firstResponse = await client.request(`/api/v1/recurring/${recurringId}/run-now`, {
      method: "POST",
    });
    const first = await firstResponse.json();

    assertEquals(firstResponse.status, 200, JSON.stringify(first));
    assertEquals(first.data.transaction.transactionDate, "2026-01-31");
    assertEquals(first.data.transaction.recurringTransactionId, recurringId);
    assertEquals(first.data.recurring.nextOccurrence, "2026-02-28");

    const secondResponse = await client.request(`/api/v1/recurring/${recurringId}/run-now`, {
      method: "POST",
    });
    const second = await secondResponse.json();

    assertEquals(secondResponse.status, 200, JSON.stringify(second));
    assertEquals(second.data.transaction.transactionDate, "2026-02-28");
    assertEquals(second.data.recurring.nextOccurrence, "2026-03-31");

    const transactionsResponse = await client.request(
      `/api/v1/accounts/${account.id}/transactions`,
    );
    const transactions = (await transactionsResponse.json()).data.transactions;
    assertEquals(transactions.length, 2);
    assertEquals(
      transactions.map((item: { transactionDate: string }) => item.transactionDate),
      ["2026-02-28", "2026-01-31"],
    );

    const deleteResponse = await client.request(`/api/v1/recurring/${recurringId}`, {
      method: "DELETE",
    });
    assertEquals(deleteResponse.status, 204);

    const runAfterDelete = await client.request(`/api/v1/recurring/${recurringId}/run-now`, {
      method: "POST",
    });
    assertEquals(runAfterDelete.status, 409);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("catch-up materializa ocorrências vencidas de forma idempotente", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const account = await createAccount(client);

    const createResponse = await client.request("/api/v1/recurring", {
      method: "POST",
      body: {
        accountId: account.id,
        type: "expense",
        amountMinor: 2000,
        frequency: "monthly",
        dayOfMonth: 31,
        startDate: "2026-01-31",
        endDate: "2026-03-31",
      },
    });
    const recurring = (await createResponse.json()).data.recurring;

    const service = new RecurringService({
      db: testApp.database.db,
      repository: new RecurringRepository(testApp.database.db),
      transactions: new TransactionsRepository(testApp.database.db),
      accounts: new AccountsRepository(testApp.database.db),
      categories: new CategoriesRepository(testApp.database.db),
    });

    const first = service.processDue("2026-03-15");
    assertEquals(first.processed, 2);
    assertEquals(first.recurrings, 1);

    const again = service.processDue("2026-03-15");
    assertEquals(again.processed, 0);
    assertEquals(again.recurrings, 0);

    const finalRun = service.processDue("2026-04-15");
    assertEquals(finalRun.processed, 1);

    const afterEnd = service.processDue("2026-05-15");
    assertEquals(afterEnd.processed, 0);

    const listResponse = await client.request(`/api/v1/accounts/${account.id}/transactions`);
    const transactions = (await listResponse.json()).data.transactions;
    assertEquals(transactions.length, 3);
    assertEquals(
      transactions.map((item: { transactionDate: string }) => item.transactionDate),
      ["2026-03-31", "2026-02-28", "2026-01-31"],
    );
    assertEquals(
      transactions.every((item: { recurringTransactionId: string }) =>
        item.recurringTransactionId === recurring.id
      ),
      true,
    );

    const detailResponse = await client.request(`/api/v1/recurring/${recurring.id}`);
    assertEquals((await detailResponse.json()).data.recurring.isActive, false);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("orçamento soma a subárvore e sinaliza os limiares 80/90/100", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const account = await createAccount(client);
    const parent = await createCategory(client, { name: "Moradia", type: "expense" });
    const child = await createCategory(client, {
      name: "Energia",
      type: "expense",
      parentId: parent.id,
    });
    const other = await createCategory(client, { name: "Lazer", type: "expense" });

    for (
      const [categoryId, amountMinor, transactionDate] of [
        [child.id, 6000, "2026-11-05"],
        [child.id, 2500, "2026-11-10"],
        [other.id, 9999, "2026-11-11"],
      ] as const
    ) {
      await createTransaction(client, {
        accountId: account.id,
        categoryId,
        type: "expense",
        amountMinor,
        transactionDate,
      });
    }

    const budgetResponse = await client.request("/api/v1/budgets", {
      method: "POST",
      body: {
        categoryId: parent.id,
        name: "Moradia",
        limitMinor: 10000,
        periodType: "monthly",
        startDate: "2026-11-01",
        alertThreshold: 80,
      },
    });
    const budget = (await budgetResponse.json()).data.budget;
    assertEquals(budgetResponse.status, 201);
    assertEquals(budget.currencyCode, "BRL");

    const loadStatus = async () => {
      const response = await client.request("/api/v1/budgets/status?date=2026-11-15");
      const body = await response.json();
      assertEquals(response.status, 200);
      return body.data.budgets[0];
    };

    const warning = await loadStatus();
    assertEquals(warning.period, { from: "2026-11-01", to: "2026-11-30" });
    assertEquals(warning.spentMinor, 8500);
    assertEquals(warning.remainingMinor, 1500);
    assertEquals(warning.percentUsed, 85);
    assertEquals(warning.level, "warning");
    assertEquals(warning.crossedThresholds, [80]);
    assertEquals(warning.isPeriodActive, true);

    await createTransaction(client, {
      accountId: account.id,
      categoryId: child.id,
      type: "expense",
      amountMinor: 1000,
      transactionDate: "2026-11-12",
    });
    const nearLimit = await loadStatus();
    assertEquals(nearLimit.spentMinor, 9500);
    assertEquals(nearLimit.level, "warning");
    assertEquals(nearLimit.crossedThresholds, [80, 90]);

    await createTransaction(client, {
      accountId: account.id,
      categoryId: child.id,
      type: "expense",
      amountMinor: 1000,
      transactionDate: "2026-11-13",
    });
    const exceeded = await loadStatus();
    assertEquals(exceeded.spentMinor, 10500);
    assertEquals(exceeded.remainingMinor, -500);
    assertEquals(exceeded.percentUsed, 105);
    assertEquals(exceeded.level, "exceeded");
    assertEquals(exceeded.crossedThresholds, [80, 90, 100]);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("meta completa ao atingir o alvo e volta a ativa ao remover contribuição", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);

    const goalResponse = await client.request("/api/v1/goals", {
      method: "POST",
      body: { name: "Viagem", targetAmountMinor: 100000, targetDate: "2027-12-31" },
    });
    const goal = (await goalResponse.json()).data.goal;
    assertEquals(goalResponse.status, 201);
    assertEquals(goal.status, "active");

    const firstResponse = await client.request(`/api/v1/goals/${goal.id}/contributions`, {
      method: "POST",
      body: { amountMinor: 60000, contributionDate: "2026-11-01", note: "Mês 1" },
    });
    const first = (await firstResponse.json()).data.progress;

    assertEquals(firstResponse.status, 201);
    assertEquals(first.contributedMinor, 60000);
    assertEquals(first.remainingMinor, 40000);
    assertEquals(first.progressPercent, 60);
    assertEquals(first.contributionCount, 1);
    assertEquals(first.goal.status, "active");

    const secondResponse = await client.request(`/api/v1/goals/${goal.id}/contributions`, {
      method: "POST",
      body: { amountMinor: 40000, contributionDate: "2026-11-02", note: "Mês 2" },
    });
    const second = (await secondResponse.json()).data.progress;

    assertEquals(second.contributedMinor, 100000);
    assertEquals(second.remainingMinor, 0);
    assertEquals(second.progressPercent, 100);
    assertEquals(second.isCompleted, true);
    assertEquals(second.goal.status, "completed");
    assertEquals(second.contributionCount, 2);

    const currencyChange = await client.request(`/api/v1/goals/${goal.id}`, {
      method: "PATCH",
      body: { currencyCode: "USD" },
    });
    assertEquals(currencyChange.status, 409);

    const secondContribution = second.contributions.find(
      (item: { amountMinor: number }) => item.amountMinor === 40000,
    );
    const deleteResponse = await client.request(
      `/api/v1/goals/${goal.id}/contributions/${secondContribution.id}`,
      { method: "DELETE" },
    );
    const afterDelete = (await deleteResponse.json()).data.progress;

    assertEquals(deleteResponse.status, 200);
    assertEquals(afterDelete.contributedMinor, 60000);
    assertEquals(afterDelete.progressPercent, 60);
    assertEquals(afterDelete.goal.status, "active");
    assertEquals(afterDelete.contributionCount, 1);

    const cancelResponse = await client.request(`/api/v1/goals/${goal.id}`, {
      method: "DELETE",
    });
    assertEquals(cancelResponse.status, 204);

    const cancelledResponse = await client.request("/api/v1/goals?status=cancelled");
    const cancelled = (await cancelledResponse.json()).data.goals;
    assertEquals(cancelled.length, 1);
    assertEquals(cancelled[0].id, goal.id);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("planejamento é isolado por usuário", async () => {
  const testApp = await createTestApp();

  try {
    const owner = await register(testApp.app, "owner@example.com");
    const stranger = await register(testApp.app, "stranger@example.com");

    const account = await createAccount(owner);
    const recurring = (await (await owner.request("/api/v1/recurring", {
      method: "POST",
      body: {
        accountId: account.id,
        type: "expense",
        amountMinor: 1000,
        frequency: "monthly",
        startDate: "2026-12-01",
      },
    })).json()).data.recurring;
    const budget = (await (await owner.request("/api/v1/budgets", {
      method: "POST",
      body: {
        name: "Geral",
        limitMinor: 10000,
        periodType: "monthly",
        startDate: "2026-11-01",
      },
    })).json()).data.budget;
    const goal = (await (await owner.request("/api/v1/goals", {
      method: "POST",
      body: { name: "Reserva", targetAmountMinor: 50000 },
    })).json()).data.goal;

    for (
      const path of [
        `/api/v1/recurring/${recurring.id}`,
        `/api/v1/budgets/${budget.id}`,
        `/api/v1/goals/${goal.id}`,
      ]
    ) {
      const response = await stranger.request(path);
      assertEquals(response.status, 404, path);
    }
  } finally {
    testApp.cleanup();
  }
});
