import { assertEquals, assertThrows } from "@std/assert";
import { createDatabase } from "../../src/db/client.ts";
import { createTestDatabase } from "../helpers/db.ts";

Deno.test("createDatabase aplica pragmas e carrega sqlite-vector", () => {
  using db = createDatabase({ path: ":memory:" });

  assertEquals(db.vectorEnabled, true);
  assertEquals(db.raw.pragma("foreign_keys", { simple: true }), 1);
  assertEquals(db.raw.pragma("busy_timeout", { simple: true }), 5_000);
  assertEquals(db.raw.pragma("synchronous", { simple: true }), 1);

  const version = db
    .prepare<[], { version: string }>("SELECT vector_version() AS version")
    .get();

  assertEquals(version?.version, "1.2.0");
});

Deno.test("createDatabase usa WAL em arquivo e persiste dados", async () => {
  const testDb = await createTestDatabase({ migrate: false, vector: false });

  try {
    assertEquals(testDb.db.raw.pragma("journal_mode", { simple: true }), "wal");

    testDb.db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL) STRICT;");
    testDb.db.prepare("INSERT INTO items (name) VALUES (?)").run("primeiro");
  } finally {
    testDb.cleanup();
  }
});

Deno.test("transaction faz rollback quando a função lança", () => {
  using db = createDatabase({ path: ":memory:", loadVectorExtension: false });
  db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL) STRICT;");

  assertThrows(() => {
    db.transaction(() => {
      db.prepare("INSERT INTO items (name) VALUES (?)").run("descartado");
      throw new Error("falha proposital");
    });
  });

  const row = db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM items").get();
  assertEquals(row?.count, 0);
});

Deno.test("transaction faz commit quando a função conclui", () => {
  using db = createDatabase({ path: ":memory:", loadVectorExtension: false });
  db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL) STRICT;");

  db.transaction(() => {
    db.prepare("INSERT INTO items (name) VALUES (?)").run("mantido");
  });

  const row = db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM items").get();
  assertEquals(row?.count, 1);
});
