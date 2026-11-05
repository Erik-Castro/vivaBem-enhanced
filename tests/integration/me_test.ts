import { assertEquals, assertExists } from "@std/assert";
import { createTestApp, type TestApp } from "../helpers/app.ts";
import { AuthTestClient } from "../helpers/auth-client.ts";

const PASSWORD = "senha-super-segura";

async function authenticatedClient(app: TestApp["app"], email: string) {
  const client = new AuthTestClient(app);
  await client.bootstrapCsrf();
  const response = await client.request("/api/v1/auth/register", {
    method: "POST",
    body: { name: "Ana", email, password: PASSWORD },
  });
  assertEquals(response.status, 201);
  return client;
}

Deno.test("GET /me sem autenticação retorna 401", async () => {
  const testApp = await createTestApp();

  try {
    const response = await testApp.app.request("/api/v1/me");
    const body = await response.json();

    assertEquals(response.status, 401);
    assertEquals(body.error.code, "UNAUTHORIZED");
  } finally {
    testApp.cleanup();
  }
});

Deno.test("GET /me retorna perfil, preferências e estatísticas", async () => {
  const testApp = await createTestApp();

  try {
    const client = await authenticatedClient(testApp.app, "ana@example.com");
    const response = await client.request("/api/v1/me");
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(body.data.user.email, "ana@example.com");
    assertEquals(body.data.user.preferences.locale, "pt-BR");
    assertEquals(body.data.stats.activeSessions, 1);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("PATCH /me atualiza nome e avatar", async () => {
  const testApp = await createTestApp();

  try {
    const client = await authenticatedClient(testApp.app, "ana@example.com");
    const response = await client.request("/api/v1/me", {
      method: "PATCH",
      body: { name: "Ana Silva", avatarUrl: "https://example.com/ana.png" },
    });
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(body.data.user.name, "Ana Silva");
    assertEquals(body.data.user.avatarUrl, "https://example.com/ana.png");
  } finally {
    testApp.cleanup();
  }
});

Deno.test("PATCH /me/preferences valida e atualiza preferências", async () => {
  const testApp = await createTestApp();

  try {
    const client = await authenticatedClient(testApp.app, "ana@example.com");

    const updated = await client.request("/api/v1/me/preferences", {
      method: "PATCH",
      body: { timezone: "Europe/Lisbon", baseCurrency: "EUR", locale: "pt-PT" },
    });
    const body = await updated.json();

    assertEquals(updated.status, 200);
    assertEquals(body.data.user.preferences.timezone, "Europe/Lisbon");
    assertEquals(body.data.user.preferences.baseCurrency, "EUR");
    assertEquals(body.data.user.preferences.locale, "pt-PT");

    const invalid = await client.request("/api/v1/me/preferences", {
      method: "PATCH",
      body: { timezone: "Marte/Olympus" },
    });
    const invalidBody = await invalid.json();

    assertEquals(invalid.status, 400);
    assertEquals(invalidBody.error.code, "VALIDATION_ERROR");
  } finally {
    testApp.cleanup();
  }
});

Deno.test("lista e revoga sessões de outros dispositivos", async () => {
  const testApp = await createTestApp();

  try {
    const first = await authenticatedClient(testApp.app, "ana@example.com");

    const second = new AuthTestClient(testApp.app);
    await second.bootstrapCsrf();
    const login = await second.request("/api/v1/auth/login", {
      method: "POST",
      body: { email: "ana@example.com", password: PASSWORD },
    });
    assertEquals(login.status, 200);

    const listed = await first.request("/api/v1/me/sessions");
    const listedBody = await listed.json();
    const sessions = listedBody.data.sessions as Array<{ id: string; current: boolean }>;

    assertEquals(listed.status, 200);
    assertEquals(sessions.length, 2);
    assertEquals(sessions.filter((session) => session.current).length, 1);

    const other = sessions.find((session) => !session.current);
    assertExists(other);

    const revoked = await first.request(`/api/v1/me/sessions/${other.id}`, {
      method: "DELETE",
    });
    assertEquals(revoked.status, 204);

    const after = await first.request("/api/v1/me/sessions");
    const afterBody = await after.json();
    assertEquals(afterBody.data.sessions.length, 1);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("revogar a própria sessão limpa os cookies", async () => {
  const testApp = await createTestApp();

  try {
    const client = await authenticatedClient(testApp.app, "ana@example.com");
    const accessToken = client.cookies.get("vb_access");
    assertExists(accessToken);

    const listed = await client.request("/api/v1/me/sessions");
    const listedBody = await listed.json();
    const current = (listedBody.data.sessions as Array<{ id: string; current: boolean }>).find(
      (session) => session.current,
    );
    assertExists(current);

    const revoked = await client.request(`/api/v1/me/sessions/${current.id}`, {
      method: "DELETE",
    });

    assertEquals(revoked.status, 204);
    assertEquals(client.cookies.has("vb_access"), false);

    const me = await testApp.app.request("/api/v1/me", {
      headers: { cookie: `vb_access=${accessToken}` },
    });
    assertEquals(me.status, 401);
  } finally {
    testApp.cleanup();
  }
});
