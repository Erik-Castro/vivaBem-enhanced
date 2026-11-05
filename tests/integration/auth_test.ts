import { assertEquals, assertExists, assertNotEquals } from "@std/assert";
import { createTestApp } from "../helpers/app.ts";
import { AuthTestClient } from "../helpers/auth-client.ts";

const PASSWORD = "senha-super-segura";

async function register(client: AuthTestClient, email = "ana@example.com") {
  return await client.request("/api/v1/auth/register", {
    method: "POST",
    body: { name: "Ana", email, password: PASSWORD },
  });
}

Deno.test("registro cria conta, define cookies e retorna perfil", async () => {
  const testApp = await createTestApp();

  try {
    const client = new AuthTestClient(testApp.app);
    await client.bootstrapCsrf();

    const response = await register(client);
    const body = await response.json();

    assertEquals(response.status, 201);
    assertEquals(body.data.user.name, "Ana");
    assertEquals(body.data.user.email, "ana@example.com");
    assertEquals(body.data.user.preferences.baseCurrency, "BRL");
    assertExists(client.cookies.get("vb_access"));
    assertExists(client.cookies.get("vb_refresh"));
    assertExists(client.cookies.get("vb_csrf"));

    const setCookies = response.headers.getSetCookie();
    assertEquals(
      setCookies.some((cookie) => cookie.startsWith("vb_access=") && cookie.includes("HttpOnly")),
      true,
    );
    assertEquals(
      setCookies.some((cookie) =>
        cookie.startsWith("vb_refresh=") && cookie.includes("Path=/api/v1/auth")
      ),
      true,
    );
    assertEquals(
      setCookies.some((cookie) => cookie.startsWith("vb_csrf=") && !cookie.includes("HttpOnly")),
      true,
    );
  } finally {
    testApp.cleanup();
  }
});

Deno.test("registro rejeita e-mail duplicado com 409", async () => {
  const testApp = await createTestApp();

  try {
    const client = new AuthTestClient(testApp.app);
    await client.bootstrapCsrf();
    await register(client);

    const response = await register(client);
    const body = await response.json();

    assertEquals(response.status, 409);
    assertEquals(body.error.code, "CONFLICT");
  } finally {
    testApp.cleanup();
  }
});

Deno.test("login aceita e-mail com caixa diferente e senha correta", async () => {
  const testApp = await createTestApp();

  try {
    const client = new AuthTestClient(testApp.app);
    await client.bootstrapCsrf();
    await register(client);
    client.cookies.delete("vb_access");
    client.cookies.delete("vb_refresh");

    const response = await client.request("/api/v1/auth/login", {
      method: "POST",
      body: { email: "ANA@EXAMPLE.COM", password: PASSWORD },
    });

    assertEquals(response.status, 200);
    assertExists(client.cookies.get("vb_refresh"));
  } finally {
    testApp.cleanup();
  }
});

Deno.test("login não revela se o e-mail existe", async () => {
  const testApp = await createTestApp();

  try {
    const client = new AuthTestClient(testApp.app);
    await client.bootstrapCsrf();
    await register(client);

    const wrongPassword = await client.request("/api/v1/auth/login", {
      method: "POST",
      body: { email: "ana@example.com", password: "senha-errada" },
    });
    const unknownEmail = await client.request("/api/v1/auth/login", {
      method: "POST",
      body: { email: "ninguem@example.com", password: "senha-errada" },
    });

    const wrongBody = await wrongPassword.json();
    const unknownBody = await unknownEmail.json();

    assertEquals(wrongPassword.status, 401);
    assertEquals(unknownEmail.status, 401);
    assertEquals(wrongBody.error.message, unknownBody.error.message);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("refresh rotaciona o token e reuso revoga a família inteira", async () => {
  const testApp = await createTestApp();

  try {
    const client = new AuthTestClient(testApp.app);
    await client.bootstrapCsrf();
    await register(client);

    const oldRefresh = client.cookies.get("vb_refresh");
    assertExists(oldRefresh);

    const refreshed = await client.request("/api/v1/auth/refresh", { method: "POST" });
    assertEquals(refreshed.status, 200);

    const newRefresh = client.cookies.get("vb_refresh");
    assertExists(newRefresh);
    assertNotEquals(newRefresh, oldRefresh);

    // Um atacante reutiliza o refresh já rotacionado.
    const attacker = new AuthTestClient(testApp.app);
    attacker.cookies.set("vb_refresh", oldRefresh);
    attacker.cookies.set("vb_csrf", client.csrfToken);
    attacker.csrfToken = client.csrfToken;

    const reuse = await attacker.request("/api/v1/auth/refresh", { method: "POST" });
    assertEquals(reuse.status, 401);

    // A família inteira foi revogada: o token novo também não funciona.
    const afterReuse = await client.request("/api/v1/auth/refresh", { method: "POST" });
    assertEquals(afterReuse.status, 401);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("logout revoga a sessão, limpa cookies e invalida o access token", async () => {
  const testApp = await createTestApp();

  try {
    const client = new AuthTestClient(testApp.app);
    await client.bootstrapCsrf();
    await register(client);

    const accessToken = client.cookies.get("vb_access");
    assertExists(accessToken);

    const logout = await client.request("/api/v1/auth/logout", { method: "POST" });
    assertEquals(logout.status, 204);
    assertEquals(client.cookies.has("vb_access"), false);
    assertEquals(client.cookies.has("vb_refresh"), false);

    // Mesmo reapresentando o access token antigo, a sessão está revogada.
    const me = await testApp.app.request("/api/v1/me", {
      headers: { cookie: `vb_access=${accessToken}` },
    });
    assertEquals(me.status, 401);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("requisição mutável sem CSRF retorna 403", async () => {
  const testApp = await createTestApp();

  try {
    const client = new AuthTestClient(testApp.app);
    await client.bootstrapCsrf();

    const response = await client.request("/api/v1/auth/register", {
      method: "POST",
      body: { name: "Ana", email: "ana@example.com", password: PASSWORD },
      useCsrf: false,
    });
    const body = await response.json();

    assertEquals(response.status, 403);
    assertEquals(body.error.code, "FORBIDDEN");
  } finally {
    testApp.cleanup();
  }
});

Deno.test("origem diferente é bloqueada mesmo com CSRF", async () => {
  const testApp = await createTestApp();

  try {
    const client = new AuthTestClient(testApp.app);
    await client.bootstrapCsrf();

    const response = await client.request("/api/v1/auth/register", {
      method: "POST",
      body: { name: "Ana", email: "ana@example.com", password: PASSWORD },
      headers: { origin: "https://malicioso.example" },
    });

    assertEquals(response.status, 403);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("rate limit bloqueia tentativas de login acima do máximo", async () => {
  const testApp = await createTestApp({ env: { RATE_LIMIT_AUTH_MAX: "3" } });

  try {
    const client = new AuthTestClient(testApp.app);
    await client.bootstrapCsrf();

    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await client.request("/api/v1/auth/login", {
        method: "POST",
        body: { email: "ninguem@example.com", password: "senha-errada" },
      });
      assertEquals(response.status, 401);
    }

    const blocked = await client.request("/api/v1/auth/login", {
      method: "POST",
      body: { email: "ninguem@example.com", password: "senha-errada" },
    });
    const body = await blocked.json();

    assertEquals(blocked.status, 429);
    assertEquals(body.error.code, "RATE_LIMITED");
    assertExists(blocked.headers.get("retry-after"));
  } finally {
    testApp.cleanup();
  }
});
