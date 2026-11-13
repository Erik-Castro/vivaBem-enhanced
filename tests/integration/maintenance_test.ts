import { assertEquals } from "@std/assert";
import { createTestDatabase, type TestDatabase } from "../helpers/db.ts";
import { runMaintenance } from "../../src/db/maintenance.ts";

const USER_ID = "01920000-0000-7000-8000-000000000001";
const NOW = new Date("2026-11-09T12:00:00.000Z");

function seedUser(db: TestDatabase["db"]): void {
  db.prepare(
    `INSERT INTO user_profiles (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
  ).run(USER_ID, "Ana", NOW.toISOString(), NOW.toISOString());
}

Deno.test("manutenção remove apenas dados operacionais vencidos", async () => {
  const database = await createTestDatabase();

  try {
    seedUser(database.db);

    const insertSession = database.db.prepare(
      `INSERT INTO user_sessions
         (id, user_id, refresh_token_hash, token_family_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insertSession.run(
      "expired-session",
      USER_ID,
      "hash-1",
      "family-1",
      "2026-11-09T11:00:00.000Z",
      NOW.toISOString(),
    );
    insertSession.run(
      "future-session",
      USER_ID,
      "hash-2",
      "family-1",
      "2026-12-09T11:00:00.000Z",
      NOW.toISOString(),
    );

    const insertEvent = database.db.prepare(
      `INSERT INTO event_outbox
         (id, type, aggregate_type, user_id, status, available_at, created_at, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertEvent.run(
      "old-completed",
      "finance.test",
      "transaction",
      USER_ID,
      "completed",
      NOW.toISOString(),
      "2026-09-01T00:00:00.000Z",
      "2026-09-01T00:00:00.000Z",
    );
    insertEvent.run(
      "new-completed",
      "finance.test",
      "transaction",
      USER_ID,
      "completed",
      NOW.toISOString(),
      "2026-11-01T00:00:00.000Z",
      "2026-11-01T00:00:00.000Z",
    );
    insertEvent.run(
      "old-pending",
      "finance.test",
      "transaction",
      USER_ID,
      "pending",
      NOW.toISOString(),
      "2026-09-01T00:00:00.000Z",
      null,
    );

    const insertBlock = database.db.prepare(
      `INSERT INTO ip_blocklist (id, ip_address, reason, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    insertBlock.run(
      "block-expired",
      "10.0.0.1",
      "abuso",
      "2026-11-09T11:00:00.000Z",
      NOW.toISOString(),
    );
    insertBlock.run(
      "block-active",
      "10.0.0.2",
      "abuso",
      "2026-12-09T11:00:00.000Z",
      NOW.toISOString(),
    );

    const insertInsight = database.db.prepare(
      `INSERT INTO ai_insights (id, user_id, category, severity, title, message, created_at)
       VALUES (?, ?, 'finance', 'low', 'Título', 'Mensagem', ?)`,
    );
    insertInsight.run("insight-live", USER_ID, NOW.toISOString());

    const insertEmbedding = database.db.prepare(
      `INSERT INTO embedding_items
         (id, user_id, source_type, source_id, content_hash, embedding, model, dimensions, created_at, updated_at)
       VALUES (?, ?, 'insight', ?, ?, ?, 'm', 3, ?, ?)`,
    );
    const vector = new Uint8Array([1, 2, 3]);
    insertEmbedding.run(
      "embedding-live",
      USER_ID,
      "insight-live",
      "hash",
      vector,
      NOW.toISOString(),
      NOW.toISOString(),
    );
    insertEmbedding.run(
      "embedding-orphan",
      USER_ID,
      "insight-gone",
      "hash",
      vector,
      NOW.toISOString(),
      NOW.toISOString(),
    );

    const result = runMaintenance(database.db, { now: NOW });

    assertEquals(result, {
      expiredSessions: 1,
      completedEvents: 1,
      expiredIpBlocks: 1,
      orphanEmbeddings: 1,
      revokedPushSubscriptions: 0,
    });

    const sessions = database.db.prepare<[], { id: string }>("SELECT id FROM user_sessions").all();
    assertEquals(sessions.map((row) => row.id), ["future-session"]);

    const events = database.db.prepare<[], { id: string }>(
      "SELECT id FROM event_outbox ORDER BY id",
    ).all();
    assertEquals(events.map((row) => row.id), ["new-completed", "old-pending"]);

    const blocks = database.db.prepare<[], { id: string }>("SELECT id FROM ip_blocklist").all();
    assertEquals(blocks.map((row) => row.id), ["block-active"]);

    const embeddings = database.db
      .prepare<[], { id: string }>("SELECT id FROM embedding_items")
      .all();
    assertEquals(embeddings.map((row) => row.id), ["embedding-live"]);
  } finally {
    database.cleanup();
  }
});

Deno.test("manutenção é idempotente e não apaga dados de domínio", async () => {
  const database = await createTestDatabase();

  try {
    seedUser(database.db);

    const first = runMaintenance(database.db, { now: NOW });
    assertEquals(first.expiredSessions, 0);

    // Uma segunda execução no mesmo instante não encontra nada para remover.
    const second = runMaintenance(database.db, { now: NOW });
    assertEquals(second, {
      expiredSessions: 0,
      completedEvents: 0,
      expiredIpBlocks: 0,
      orphanEmbeddings: 0,
      revokedPushSubscriptions: 0,
    });

    const user = database.db
      .prepare<[string], { id: string }>("SELECT id FROM user_profiles WHERE id = ?")
      .get(USER_ID);
    assertEquals(user?.id, USER_ID);
  } finally {
    database.cleanup();
  }
});
