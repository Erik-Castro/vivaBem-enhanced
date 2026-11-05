import { assertEquals, assertMatch } from "@std/assert";
import { uuidv7, uuidv7Timestamp } from "../../src/shared/utils/uuid.ts";

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

Deno.test("uuidv7 gera UUID versão 7 com variante RFC", () => {
  for (let index = 0; index < 100; index++) {
    assertMatch(uuidv7(), UUID_V7_PATTERN);
  }
});

Deno.test("uuidv7 preserva o timestamp", () => {
  const now = 1_760_000_000_000;
  const uuid = uuidv7(now);

  assertEquals(uuidv7Timestamp(uuid), now);
});

Deno.test("uuidv7Timestamp rejeita valores inválidos", () => {
  assertEquals(uuidv7Timestamp("não é uuid"), undefined);
  assertEquals(uuidv7Timestamp("0198f3c2-0000-7000-8000"), undefined);
});
