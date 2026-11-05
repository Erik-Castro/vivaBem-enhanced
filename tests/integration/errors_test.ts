import { assertEquals } from "@std/assert";
import { createTestApp } from "../helpers/app.ts";

Deno.test("rota inexistente retorna envelope de erro padronizado", async () => {
  const testApp = await createTestApp();

  try {
    const response = await testApp.app.request("/nao-existe");
    const body = await response.json();

    assertEquals(response.status, 404);
    assertEquals(body.error.code, "NOT_FOUND");
    assertEquals(body.error.message, "Rota não encontrada");
    assertEquals(typeof body.error.requestId, "string");
  } finally {
    testApp.cleanup();
  }
});

Deno.test("corpo acima de 1 MB retorna PAYLOAD_TOO_LARGE", async () => {
  const testApp = await createTestApp();

  try {
    const response = await testApp.app.request("/health", {
      method: "POST",
      body: "x".repeat(1024 * 1024 + 1),
      headers: { "content-type": "text/plain" },
    });
    const body = await response.json();

    assertEquals(response.status, 413);
    assertEquals(body.error.code, "PAYLOAD_TOO_LARGE");
  } finally {
    testApp.cleanup();
  }
});
