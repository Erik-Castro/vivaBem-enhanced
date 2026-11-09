import { assertEquals } from "@std/assert";
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

async function createAccount(client: AuthTestClient, type = "checking"): Promise<string> {
  const response = await client.request("/api/v1/accounts", {
    method: "POST",
    body: { name: `Conta ${type}`, type },
  });
  const body = await response.json();
  assertEquals(response.status, 201, JSON.stringify(body));
  return body.data.account.id;
}

function upload(accountId: string, content: string, fileName = "extrato.csv"): FormData {
  const form = new FormData();
  form.set("accountId", accountId);
  form.set("file", new File([content], fileName, { type: "text/csv" }));
  return form;
}

const CSV = [
  "Data;Valor;Descrição;ID",
  "05/11/2026;-123,45;Mercado;ext-1",
  "06/11/2026;500,00;Salário;ext-2",
].join("\n");

Deno.test("rotas de importação exigem autenticação", async () => {
  const testApp = await createTestApp();

  try {
    for (const path of ["/api/v1/import/preview", "/api/v1/import/commit"]) {
      const response = await testApp.app.request(path, { method: "POST" });
      // POST sem CSRF é barrado antes da autenticação.
      assertEquals(response.status, 403);
      assertEquals((await response.json()).error.code, "FORBIDDEN");
    }
  } finally {
    testApp.cleanup();
  }
});

Deno.test("preview marca linhas novas e commit é idempotente", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const accountId = await createAccount(client);

    const preview = await client.requestForm(
      "/api/v1/import/preview",
      upload(accountId, CSV),
    );
    const previewBody = await preview.json();
    assertEquals(preview.status, 200, JSON.stringify(previewBody));
    assertEquals(previewBody.data.format, "csv");
    assertEquals(previewBody.data.totalRows, 2);
    assertEquals(previewBody.data.validRows, 2);
    assertEquals(previewBody.data.newRows, 2);
    assertEquals(previewBody.data.duplicateRows, 0);
    assertEquals(previewBody.data.rows[0].duplicate, false);
    assertEquals(previewBody.data.rows[0].importHash.length, 64);

    const first = await client.requestForm("/api/v1/import/commit", upload(accountId, CSV));
    const firstBody = await first.json();
    assertEquals(first.status, 200, JSON.stringify(firstBody));
    assertEquals(firstBody.data.imported, 2);
    assertEquals(firstBody.data.skipped, 0);
    assertEquals(firstBody.data.transactionIds.length, 2);

    const second = await client.requestForm("/api/v1/import/commit", upload(accountId, CSV));
    const secondBody = await second.json();
    assertEquals(second.status, 200);
    assertEquals(secondBody.data.imported, 0);
    assertEquals(secondBody.data.skipped, 2);

    const previewAgain = await client.requestForm(
      "/api/v1/import/preview",
      upload(accountId, CSV),
    );
    const previewAgainBody = await previewAgain.json();
    assertEquals(previewAgainBody.data.newRows, 0);
    assertEquals(previewAgainBody.data.duplicateRows, 2);
    assertEquals(
      previewAgainBody.data.rows.every((row: { duplicate: boolean }) => row.duplicate),
      true,
    );

    const transactions = await client.request(`/api/v1/transactions?accountId=${accountId}`);
    const transactionsBody = await transactions.json();
    assertEquals(transactions.status, 200);
    assertEquals(transactionsBody.data.transactions.length, 2);
    assertEquals(
      transactionsBody.data.transactions.map((transaction: { externalId: string }) =>
        transaction.externalId
      ).sort(),
      ["ext-1", "ext-2"],
    );
    const expense = transactionsBody.data.transactions.find(
      (transaction: { externalId: string }) => transaction.externalId === "ext-1",
    );
    assertEquals(expense.type, "expense");
  } finally {
    testApp.cleanup();
  }
});

Deno.test("preview reporta linhas inválidas sem interromper o arquivo", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const accountId = await createAccount(client);

    const content = [
      "date,amount,description",
      "2026-11-01,10.00,Ok",
      "data-invalida,20.00,Erro",
      "2026-11-03,0,Zero",
    ].join("\n");

    const response = await client.requestForm(
      "/api/v1/import/preview",
      upload(accountId, content, "extrato.csv"),
    );
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(body.data.validRows, 1);
    assertEquals(body.data.errors.length, 2);
    assertEquals(body.data.totalRows, 3);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("importação valida conta, arquivo e limite de tamanho", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const accountId = await createAccount(client);

    const missingAccount = await client.requestForm(
      "/api/v1/import/preview",
      upload("00000000-0000-0000-0000-000000000000", CSV),
    );
    assertEquals(missingAccount.status, 404);

    const noFile = new FormData();
    noFile.set("accountId", accountId);
    const invalid = await client.requestForm("/api/v1/import/preview", noFile);
    assertEquals(invalid.status, 400);
    assertEquals((await invalid.json()).error.code, "VALIDATION_ERROR");

    const huge = "date,amount\n2026-11-01,10.00\n" + "x".repeat(1024 * 1024);
    const tooLarge = await client.requestForm(
      "/api/v1/import/preview",
      upload(accountId, huge),
    );
    assertEquals(tooLarge.status, 413);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("importa OFX e reconhece duplicados pelo FITID", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const accountId = await createAccount(client);

    const ofx = [
      "OFXHEADER:100",
      "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>",
      "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261101<TRNAMT>-10.00<FITID>ofx-1<MEMO>Café</STMTTRN>",
      "</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>",
    ].join("\n");

    const first = await client.requestForm(
      "/api/v1/import/commit",
      upload(accountId, ofx, "extrato.ofx"),
    );
    const firstBody = await first.json();
    assertEquals(first.status, 200, JSON.stringify(firstBody));
    assertEquals(firstBody.data.format, "ofx");
    assertEquals(firstBody.data.imported, 1);

    const second = await client.requestForm(
      "/api/v1/import/commit",
      upload(accountId, ofx, "extrato.ofx"),
    );
    const secondBody = await second.json();
    assertEquals(secondBody.data.imported, 0);
    assertEquals(secondBody.data.skipped, 1);
  } finally {
    testApp.cleanup();
  }
});
