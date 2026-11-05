import { assertEquals, assertExists } from "@std/assert";
import { createTestApp } from "../helpers/app.ts";
import { APP_VERSION } from "../../src/version.ts";

Deno.test("GET /health responde 200 com versão e request id", async () => {
  const testApp = await createTestApp();

  try {
    const response = await testApp.app.request("/health");
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(body.data.status, "ok");
    assertEquals(body.data.version, APP_VERSION);
    assertEquals(typeof body.meta.requestId, "string");
    assertExists(response.headers.get("x-request-id"));
    assertEquals(response.headers.get("x-content-type-options"), "nosniff");
  } finally {
    testApp.cleanup();
  }
});

Deno.test("GET /health reaproveita X-Request-Id válido", async () => {
  const testApp = await createTestApp();

  try {
    const requestId = "req-1234567890";
    const response = await testApp.app.request("/health", {
      headers: { "X-Request-Id": requestId },
    });
    const body = await response.json();

    assertEquals(response.headers.get("x-request-id"), requestId);
    assertEquals(body.meta.requestId, requestId);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("GET /ready responde 200 quando o banco está migrado", async () => {
  const testApp = await createTestApp();

  try {
    const response = await testApp.app.request("/ready");
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(body.data.status, "ready");
    assertEquals(body.data.checks.database, "ok");
    assertEquals(body.data.checks.migrations >= 1, true);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("GET /api/v1/openapi.json expõe OpenAPI 3.1 válido", async () => {
  const testApp = await createTestApp();

  try {
    const response = await testApp.app.request("/api/v1/openapi.json");
    const document = await response.json();

    assertEquals(response.status, 200);
    assertEquals(document.openapi, "3.1.0");
    assertEquals(document.info.version, APP_VERSION);
    assertEquals(typeof document.paths["/health"], "object");
    assertEquals(typeof document.paths["/ready"], "object");
  } finally {
    testApp.cleanup();
  }
});

Deno.test("GET /api/docs serve o Swagger UI", async () => {
  const testApp = await createTestApp();

  try {
    const response = await testApp.app.request("/api/docs");
    const html = await response.text();

    assertEquals(response.status, 200);
    assertEquals(html.includes("swagger"), true);
  } finally {
    testApp.cleanup();
  }
});
