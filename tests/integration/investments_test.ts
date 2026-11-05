import { assertEquals } from "@std/assert";
import { createTestApp, type TestApp } from "../helpers/app.ts";
import { AuthTestClient } from "../helpers/auth-client.ts";
import { addDays, todayUtc } from "../../src/shared/utils/date.ts";

const PASSWORD = "senha-super-segura";

async function register(
  app: TestApp["app"],
  email = "investments@example.com",
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

async function createInvestment(
  client: AuthTestClient,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await client.request("/api/v1/investments", { method: "POST", body });
  const json = await response.json();
  assertEquals(response.status, 201, JSON.stringify(json));
  return json.data.investment;
}

async function addOperation(
  client: AuthTestClient,
  investmentId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await client.request(
    `/api/v1/investments/${investmentId}/transactions`,
    { method: "POST", body },
  );
  const json = await response.json();
  assertEquals(response.status, 201, JSON.stringify(json));
  return json.data.transaction;
}

async function getPerformance(
  client: AuthTestClient,
  investmentId: string,
): Promise<Record<string, number | string | null>> {
  const response = await client.request(
    `/api/v1/investments/${investmentId}/performance`,
  );
  const json = await response.json();
  assertEquals(response.status, 200, JSON.stringify(json));
  return json.data.performance;
}

Deno.test("rotas de investimentos exigem autenticação", async () => {
  const testApp = await createTestApp();

  try {
    for (
      const path of [
        "/api/v1/investments",
        "/api/v1/investments/portfolio",
        "/api/v1/investments/unknown",
        "/api/v1/investments/unknown/transactions",
        "/api/v1/investments/unknown/performance",
        "/api/v1/investments/unknown/quotes",
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

Deno.test("fluxo de investimentos calcula posição, custo médio e P&L", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const account = await createAccount(client);
    const today = todayUtc();

    const investment = await createInvestment(client, {
      ticker: "PETR4",
      name: "Petrobras PN",
      assetClass: "stock",
    });

    assertEquals(investment.ticker, "PETR4");
    assertEquals(investment.assetClass, "stock");
    assertEquals(investment.currencyCode, "BRL");

    const investmentId = String(investment.id);

    await addOperation(client, investmentId, {
      accountId: account.id,
      operationType: "buy",
      quantity: 10,
      unitPriceMinor: 1_000,
      operationDate: today,
    });

    await addOperation(client, investmentId, {
      accountId: account.id,
      operationType: "buy",
      quantity: 10,
      unitPriceMinor: 1_200,
      feesMinor: 100,
      operationDate: today,
    });

    await addOperation(client, investmentId, {
      accountId: account.id,
      operationType: "sell",
      quantity: 5,
      unitPriceMinor: 1_500,
      feesMinor: 10,
      operationDate: today,
    });

    await addOperation(client, investmentId, {
      accountId: account.id,
      operationType: "dividend",
      quantity: 15,
      unitPriceMinor: 50,
      operationDate: today,
    });

    await addOperation(client, investmentId, {
      accountId: account.id,
      operationType: "fee",
      feesMinor: 25,
      operationDate: today,
    });

    const beforeQuote = await getPerformance(client, investmentId);
    assertEquals(beforeQuote.quantity, 15);
    assertEquals(beforeQuote.investedMinor, 22_000);
    assertEquals(beforeQuote.proceedsMinor, 7_500);
    assertEquals(beforeQuote.costBasisMinor, 16_575);
    assertEquals(beforeQuote.averageCostMinor, 1_105);
    assertEquals(beforeQuote.realizedPnlMinor, 1_940);
    assertEquals(beforeQuote.dividendsMinor, 750);
    assertEquals(beforeQuote.feesMinor, 135);
    assertEquals(beforeQuote.currentPriceMinor, null);
    assertEquals(beforeQuote.marketValueMinor, null);
    assertEquals(beforeQuote.unrealizedPnlMinor, null);
    assertEquals(beforeQuote.totalPnlMinor, 2_690);
    assertEquals(beforeQuote.returnPercent, 12.23);

    const quoteResponse = await client.request(
      `/api/v1/investments/${investmentId}/quotes`,
      {
        method: "POST",
        body: {
          priceMinor: 1_300,
          quotedAt: "2026-11-05T10:00:00.000Z",
          source: "manual",
        },
      },
    );
    const quoteJson = await quoteResponse.json();
    assertEquals(quoteResponse.status, 201, JSON.stringify(quoteJson));
    assertEquals(quoteJson.data.quote.priceMinor, 1_300);

    // Cotação mais antiga não deve substituir a mais recente.
    const olderQuote = await client.request(
      `/api/v1/investments/${investmentId}/quotes`,
      {
        method: "POST",
        body: { priceMinor: 1_250, quotedAt: "2026-11-05T09:00:00.000Z" },
      },
    );
    assertEquals(olderQuote.status, 201);

    const afterQuote = await getPerformance(client, investmentId);
    assertEquals(afterQuote.currentPriceMinor, 1_300);
    assertEquals(afterQuote.marketValueMinor, 19_500);
    assertEquals(afterQuote.unrealizedPnlMinor, 2_925);
    assertEquals(afterQuote.totalPnlMinor, 5_615);
    assertEquals(afterQuote.returnPercent, 25.52);
    assertEquals(afterQuote.quoteQuotedAt, "2026-11-05T10:00:00.000Z");

    const quotesResponse = await client.request(
      `/api/v1/investments/${investmentId}/quotes`,
    );
    const quotesJson = await quotesResponse.json();
    assertEquals(quotesResponse.status, 200);
    assertEquals(
      quotesJson.data.quotes.map((entry: { priceMinor: number }) => entry.priceMinor),
      [1_300, 1_250],
    );

    const transactionsResponse = await client.request(
      `/api/v1/investments/${investmentId}/transactions?limit=2&offset=0`,
    );
    const transactionsJson = await transactionsResponse.json();
    assertEquals(transactionsResponse.status, 200);
    assertEquals(transactionsJson.data.transactions.length, 2);
    assertEquals(transactionsJson.meta.hasMore, true);
    assertEquals(transactionsJson.meta.limit, 2);

    const lastPageResponse = await client.request(
      `/api/v1/investments/${investmentId}/transactions?limit=2&offset=4`,
    );
    const lastPageJson = await lastPageResponse.json();
    assertEquals(lastPageJson.data.transactions.length, 1);
    assertEquals(lastPageJson.meta.hasMore, false);

    const portfolioResponse = await client.request("/api/v1/investments/portfolio");
    const portfolioJson = await portfolioResponse.json();
    assertEquals(portfolioResponse.status, 200);
    assertEquals(portfolioJson.data.positions.length, 1);
    assertEquals(portfolioJson.data.positions[0].totalPnlMinor, 5_615);

    const totals = portfolioJson.data.totals[0];
    assertEquals(totals.currencyCode, "BRL");
    assertEquals(totals.investmentCount, 1);
    assertEquals(totals.pricedCount, 1);
    assertEquals(totals.marketValueMinor, 19_500);
    assertEquals(totals.unrealizedPnlMinor, 2_925);
    assertEquals(totals.totalPnlMinor, 5_615);
    assertEquals(totals.valuationComplete, true);

    // Filtro por classe e ticker único (case-insensitive).
    await createInvestment(client, {
      ticker: "BTC",
      name: "Bitcoin",
      assetClass: "crypto",
    });

    const filteredResponse = await client.request(
      "/api/v1/investments?assetClass=stock",
    );
    const filteredJson = await filteredResponse.json();
    assertEquals(filteredJson.data.investments.length, 1);
    assertEquals(filteredJson.data.investments[0].ticker, "PETR4");

    const duplicateResponse = await client.request("/api/v1/investments", {
      method: "POST",
      body: { ticker: "petr4", name: "Duplicado", assetClass: "stock" },
    });
    assertEquals(duplicateResponse.status, 409);

    // Moeda é imutável depois de existirem operações.
    const currencyResponse = await client.request(`/api/v1/investments/${investmentId}`, {
      method: "PATCH",
      body: { currencyCode: "USD" },
    });
    assertEquals(currencyResponse.status, 409);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("operações validam conta, data e venda a descoberto", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app, "validate@example.com");
    const account = await createAccount(client);
    const usdAccount = await createAccount(client, {
      name: "Conta USD",
      type: "checking",
      currencyCode: "USD",
    });
    const today = todayUtc();

    const investment = await createInvestment(client, {
      ticker: "VALE3",
      name: "Vale ON",
      assetClass: "stock",
    });
    const investmentId = String(investment.id);

    const mismatchResponse = await client.request(
      `/api/v1/investments/${investmentId}/transactions`,
      {
        method: "POST",
        body: {
          accountId: usdAccount.id,
          operationType: "buy",
          quantity: 1,
          unitPriceMinor: 1_000,
          operationDate: today,
        },
      },
    );
    assertEquals(mismatchResponse.status, 400);

    const futureResponse = await client.request(
      `/api/v1/investments/${investmentId}/transactions`,
      {
        method: "POST",
        body: {
          accountId: account.id,
          operationType: "buy",
          quantity: 1,
          unitPriceMinor: 1_000,
          operationDate: addDays(today, 1),
        },
      },
    );
    assertEquals(futureResponse.status, 400);

    const pastResponse = await client.request(
      `/api/v1/investments/${investmentId}/transactions`,
      {
        method: "POST",
        body: {
          accountId: account.id,
          operationType: "buy",
          quantity: 1,
          unitPriceMinor: 1_000,
          operationDate: addDays(today, -1),
        },
      },
    );
    assertEquals(pastResponse.status, 400);

    const oversellResponse = await client.request(
      `/api/v1/investments/${investmentId}/transactions`,
      {
        method: "POST",
        body: {
          accountId: account.id,
          operationType: "sell",
          quantity: 1,
          unitPriceMinor: 1_000,
          operationDate: today,
        },
      },
    );
    assertEquals(oversellResponse.status, 400);

    await addOperation(client, investmentId, {
      accountId: account.id,
      operationType: "buy",
      quantity: 2,
      unitPriceMinor: 1_000,
      operationDate: today,
    });

    const stillOversellResponse = await client.request(
      `/api/v1/investments/${investmentId}/transactions`,
      {
        method: "POST",
        body: {
          accountId: account.id,
          operationType: "sell",
          quantity: 3,
          unitPriceMinor: 1_000,
          operationDate: today,
        },
      },
    );
    assertEquals(stillOversellResponse.status, 400);

    const deactivateResponse = await client.request(
      `/api/v1/accounts/${account.id}`,
      { method: "PATCH", body: { isActive: false } },
    );
    assertEquals(deactivateResponse.status, 200);

    const inactiveResponse = await client.request(
      `/api/v1/investments/${investmentId}/transactions`,
      {
        method: "POST",
        body: {
          accountId: account.id,
          operationType: "buy",
          quantity: 1,
          unitPriceMinor: 1_000,
          operationDate: today,
        },
      },
    );
    assertEquals(inactiveResponse.status, 400);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("investimentos são isolados por usuário", async () => {
  const testApp = await createTestApp();

  try {
    const owner = await register(testApp.app, "owner@example.com");
    const intruder = await register(testApp.app, "intruder@example.com");

    const ownerAccount = await createAccount(owner);
    const intruderAccount = await createAccount(intruder, {
      name: "Conta do intruso",
      type: "checking",
    });

    const investment = await createInvestment(owner, {
      ticker: "ITUB4",
      name: "Itaú PN",
      assetClass: "stock",
    });
    const investmentId = String(investment.id);

    for (
      const path of [
        `/api/v1/investments/${investmentId}`,
        `/api/v1/investments/${investmentId}/transactions`,
        `/api/v1/investments/${investmentId}/performance`,
        `/api/v1/investments/${investmentId}/quotes`,
      ]
    ) {
      const response = await intruder.request(path);
      assertEquals(response.status, 404, path);
    }

    const addResponse = await intruder.request(
      `/api/v1/investments/${investmentId}/transactions`,
      {
        method: "POST",
        body: {
          accountId: intruderAccount.id,
          operationType: "buy",
          quantity: 1,
          unitPriceMinor: 1_000,
          operationDate: todayUtc(),
        },
      },
    );
    assertEquals(addResponse.status, 404);

    const portfolioResponse = await intruder.request("/api/v1/investments/portfolio");
    const portfolioJson = await portfolioResponse.json();
    assertEquals(portfolioJson.data.positions.length, 0);
    assertEquals(portfolioJson.data.totals.length, 0);

    // A conta do dono também não pode ser usada por outro usuário.
    const crossAccountResponse = await intruder.request(
      `/api/v1/investments/${investmentId}/transactions`,
      {
        method: "POST",
        body: {
          accountId: ownerAccount.id,
          operationType: "buy",
          quantity: 1,
          unitPriceMinor: 1_000,
          operationDate: todayUtc(),
        },
      },
    );
    assertEquals(crossAccountResponse.status, 404);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("soft delete remove o ativo e libera o ticker", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app, "delete@example.com");
    const investment = await createInvestment(client, {
      ticker: "AAPL",
      name: "Apple",
      assetClass: "stock",
    });
    const investmentId = String(investment.id);

    const deleteResponse = await client.request(`/api/v1/investments/${investmentId}`, {
      method: "DELETE",
    });
    assertEquals(deleteResponse.status, 204);

    const getResponse = await client.request(`/api/v1/investments/${investmentId}`);
    assertEquals(getResponse.status, 404);

    const recreateResponse = await client.request("/api/v1/investments", {
      method: "POST",
      body: { ticker: "AAPL", name: "Apple de novo", assetClass: "stock" },
    });
    assertEquals(recreateResponse.status, 201);
  } finally {
    testApp.cleanup();
  }
});
