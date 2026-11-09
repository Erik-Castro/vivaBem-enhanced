import { assertEquals } from "@std/assert";
import { createTestApp } from "../helpers/app.ts";
import { AuthTestClient } from "../helpers/auth-client.ts";

Deno.test("respostas da API recebem headers de segurança e não são cacheadas", async () => {
  const testApp = await createTestApp();

  try {
    const response = await testApp.app.request("/health");

    assertEquals(response.status, 200);
    assertEquals(response.headers.get("x-content-type-options"), "nosniff");
    assertEquals(response.headers.get("x-frame-options"), "DENY");
    assertEquals(response.headers.get("referrer-policy"), "no-referrer");
    assertEquals(response.headers.get("cross-origin-resource-policy"), "same-origin");
    assertEquals(response.headers.get("cross-origin-opener-policy"), "same-origin");
    assertEquals(response.headers.get("x-permitted-cross-domain-policies"), "none");
    assertEquals(response.headers.get("cache-control"), "no-store");
    assertEquals(
      response.headers.get("content-security-policy"),
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
  } finally {
    testApp.cleanup();
  }
});

Deno.test("Swagger UI fica sem CSP para não quebrar a documentação", async () => {
  const testApp = await createTestApp();

  try {
    const response = await testApp.app.request("/api/docs");

    assertEquals(response.status, 200);
    assertEquals(response.headers.get("content-security-policy"), null);
    // Os demais headers continuam aplicados.
    assertEquals(response.headers.get("x-content-type-options"), "nosniff");
    assertEquals(response.headers.get("x-frame-options"), "DENY");
  } finally {
    testApp.cleanup();
  }
});

Deno.test("exportação tem limite de taxa próprio por IP", async () => {
  const testApp = await createTestApp({ env: { RATE_LIMIT_DATA_MAX: "1" } });

  try {
    const headers = { "x-forwarded-for": "203.0.113.10" };

    // A primeira chamada passa pelo rate limit e para na autenticação.
    const first = await testApp.app.request("/api/v1/export", { headers });
    assertEquals(first.status, 401);
    assertEquals(first.headers.get("x-ratelimit-limit"), "1");
    assertEquals(first.headers.get("x-ratelimit-remaining"), "0");

    const second = await testApp.app.request("/api/v1/export", { headers });
    assertEquals(second.status, 429);
    assertEquals((await second.json()).error.code, "RATE_LIMITED");
    assertEquals(second.headers.get("retry-after") !== null, true);

    // Outro IP não é afetado pelo limite do primeiro.
    const other = await testApp.app.request("/api/v1/export", {
      headers: { "x-forwarded-for": "203.0.113.11" },
    });
    assertEquals(other.status, 401);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("rotas de importação também usam o limite de dados", async () => {
  const testApp = await createTestApp({ env: { RATE_LIMIT_DATA_MAX: "1" } });

  try {
    const client = new AuthTestClient(testApp.app);
    await client.bootstrapCsrf();
    const headers = { "x-forwarded-for": "203.0.113.20" };

    // CSRF roda antes: com o token válido, a chamada passa pelo limite e para
    // na autenticação.
    const first = await client.request("/api/v1/import/preview", {
      method: "POST",
      headers,
    });
    assertEquals(first.status, 401);

    const second = await client.request("/api/v1/import/preview", {
      method: "POST",
      headers,
    });
    assertEquals(second.status, 429);
  } finally {
    testApp.cleanup();
  }
});
