import { assertEquals } from "@std/assert";
import { createTestApp } from "../helpers/app.ts";
import { AuthTestClient } from "../helpers/auth-client.ts";

const PASSWORD = "senha-super-segura";

function registerBody(email: string) {
  return { name: "Ana", email, password: PASSWORD };
}

Deno.test("cadastro público aceita Idempotency-Key sem sessão", async () => {
  const testApp = await createTestApp();

  try {
    const client = new AuthTestClient(testApp.app);
    await client.bootstrapCsrf();

    const response = await client.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: registerBody("idem-register@example.com"),
    });
    const body = await response.json();

    assertEquals(response.status, 201);
    assertEquals(body.data.user.email, "idem-register@example.com");
    assertEquals(client.cookies.has("vb_access"), true);
    assertEquals(client.cookies.has("vb_refresh"), true);
    assertEquals(client.cookies.has("vb_csrf"), true);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("cadastro público funciona sem Idempotency-Key", async () => {
  const testApp = await createTestApp();

  try {
    const client = new AuthTestClient(testApp.app);
    await client.bootstrapCsrf();

    const response = await client.request("/api/v1/auth/register", {
      method: "POST",
      body: registerBody("plain-register@example.com"),
    });

    assertEquals(response.status, 201);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("login aceita Idempotency-Key sem sessão prévia", async () => {
  const testApp = await createTestApp();

  try {
    const client = new AuthTestClient(testApp.app);
    await client.bootstrapCsrf();
    await client.request("/api/v1/auth/register", {
      method: "POST",
      body: registerBody("idem-login@example.com"),
    });
    client.cookies.delete("vb_access");
    client.cookies.delete("vb_refresh");

    const response = await client.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: { email: "idem-login@example.com", password: PASSWORD },
    });

    assertEquals(response.status, 200);
    assertEquals(client.cookies.has("vb_refresh"), true);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("logout aceita Idempotency-Key", async () => {
  const testApp = await createTestApp();

  try {
    const client = new AuthTestClient(testApp.app);
    await client.bootstrapCsrf();
    await client.request("/api/v1/auth/register", {
      method: "POST",
      body: registerBody("idem-logout@example.com"),
    });

    const response = await client.request("/api/v1/auth/logout", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });

    assertEquals(response.status, 204);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("cadastro sem CSRF continua bloqueado com 403", async () => {
  const testApp = await createTestApp();

  try {
    const client = new AuthTestClient(testApp.app);
    await client.bootstrapCsrf();

    const response = await client.request("/api/v1/auth/register", {
      method: "POST",
      useCsrf: false,
      body: registerBody("no-csrf@example.com"),
    });

    assertEquals(response.status, 403);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("cadastro com CSRF inválido continua bloqueado com 403", async () => {
  const testApp = await createTestApp();

  try {
    const client = new AuthTestClient(testApp.app);
    await client.bootstrapCsrf();

    const response = await client.request("/api/v1/auth/register", {
      method: "POST",
      useCsrf: false,
      headers: { "x-csrf-token": "token-invalido" },
      body: registerBody("bad-csrf@example.com"),
    });

    assertEquals(response.status, 403);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("cadastro com origem não autorizada continua bloqueado com 403", async () => {
  const testApp = await createTestApp();

  try {
    const client = new AuthTestClient(testApp.app);
    await client.bootstrapCsrf();

    const response = await client.request("/api/v1/auth/register", {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: registerBody("bad-origin@example.com"),
    });

    assertEquals(response.status, 403);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("rota protegida sem sessão e com chave responde 401", async () => {
  const testApp = await createTestApp();

  try {
    const client = new AuthTestClient(testApp.app);
    await client.bootstrapCsrf();
    client.cookies.delete("vb_access");
    client.cookies.delete("vb_refresh");

    const response = await client.request("/api/v1/accounts", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: { name: "Conta", type: "checking" },
    });

    assertEquals(response.status, 401);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("rota protegida autenticada aceita chave e sem chave", async () => {
  const testApp = await createTestApp();

  try {
    const client = new AuthTestClient(testApp.app);
    await client.bootstrapCsrf();
    await client.request("/api/v1/auth/register", {
      method: "POST",
      body: registerBody("protected@example.com"),
    });

    const withKey = await client.request("/api/v1/accounts", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: { name: "Com chave", type: "checking" },
    });

    const withoutKey = await client.request("/api/v1/accounts", {
      method: "POST",
      body: { name: "Sem chave", type: "savings" },
    });

    assertEquals(withKey.status, 201);
    assertEquals(withoutKey.status, 201);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("repetição de escrita autenticada com a mesma chave é idempotente", async () => {
  const testApp = await createTestApp();

  try {
    const client = new AuthTestClient(testApp.app);
    await client.bootstrapCsrf();
    await client.request("/api/v1/auth/register", {
      method: "POST",
      body: registerBody("repeat@example.com"),
    });

    const key = crypto.randomUUID();
    const headers = { "Idempotency-Key": key };

    const first = await client.request("/api/v1/accounts", {
      method: "POST",
      headers,
      body: { name: "Conta única", type: "checking" },
    });
    const firstBody = await first.json();

    const second = await client.request("/api/v1/accounts", {
      method: "POST",
      headers,
      body: { name: "Conta única", type: "checking" },
    });
    const secondBody = await second.json();

    assertEquals(first.status, 201);
    assertEquals(second.status, 201);
    assertEquals(secondBody.data.account.id, firstBody.data.account.id);

    const list = await client.request("/api/v1/accounts");
    const listBody = await list.json();
    assertEquals(listBody.data.accounts.length, 1);
  } finally {
    testApp.cleanup();
  }
});
