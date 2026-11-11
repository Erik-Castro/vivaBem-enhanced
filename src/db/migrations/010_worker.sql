-- Fase 11: extração do worker para processo independente.
--
-- 1. A outbox passa a ter lease explícito (`lease_token` + `lease_expires_at`).
--    O token muda a cada aquisição e protege confirmações de instâncias que
--    perderam a posse do evento.
-- 2. O estado terminal ganha o nome `dead_letter`. `failed` continua aceito
--    para que uma imagem antiga (rollback) ainda consiga gravar falhas, mas
--    nenhum código novo o produz.
-- 3. Replay manual é rastreado por `replay_count`/`replayed_at`.
--
-- SQLite não altera CHECK constraint: a tabela é reconstruída. O runner roda
-- cada migração em uma transação, então uma falha no meio não deixa estado
-- parcial.

CREATE TABLE event_outbox_new (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT,
  user_id TEXT NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  priority INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TEXT NOT NULL,
  locked_at TEXT,
  worker_id TEXT,
  -- Lease da aquisição corrente. Linhas legadas (rollback) podem ficar sem
  -- token; a recuperação trata esse caso pelo `locked_at`.
  lease_token TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  processed_at TEXT,
  replay_count INTEGER NOT NULL DEFAULT 0 CHECK (replay_count >= 0),
  replayed_at TEXT,
  -- Estados terminais não mantêm lease; `processing` sempre tem dono.
  CHECK (
    (status = 'processing' AND locked_at IS NOT NULL AND worker_id IS NOT NULL)
    OR (status <> 'processing' AND locked_at IS NULL AND worker_id IS NULL)
  )
) STRICT;

INSERT INTO event_outbox_new (
  id, type, aggregate_type, aggregate_id, user_id, payload, status, priority,
  attempts, available_at, locked_at, worker_id, lease_token, lease_expires_at,
  last_error, created_at, processed_at, replay_count, replayed_at
)
SELECT
  id, type, aggregate_type, aggregate_id, user_id, payload,
  CASE status WHEN 'failed' THEN 'dead_letter' ELSE status END,
  priority, attempts, available_at, locked_at, worker_id,
  -- Eventos em processamento no momento da migração recebem um lease novo,
  -- válido pelo mesmo prazo mínimo usado pelo worker (120s).
  CASE
    WHEN status = 'processing' THEN lower(hex(randomblob(16)))
    ELSE NULL
  END,
  CASE
    WHEN status = 'processing' THEN
      strftime('%Y-%m-%dT%H:%M:%fZ', locked_at, '+120 seconds')
    ELSE NULL
  END,
  last_error, created_at, processed_at, 0, NULL
FROM event_outbox;

DROP TABLE event_outbox;
ALTER TABLE event_outbox_new RENAME TO event_outbox;

-- Ordem de claim: prioridade, disponibilidade e idade.
CREATE INDEX idx_event_outbox_claim
  ON event_outbox (status, available_at, priority DESC, created_at);
CREATE INDEX idx_event_outbox_processing
  ON event_outbox (status, locked_at);
CREATE INDEX idx_event_outbox_user
  ON event_outbox (user_id, created_at DESC);
CREATE INDEX idx_event_outbox_cleanup
  ON event_outbox (status, processed_at)
  WHERE processed_at IS NOT NULL;
-- Recuperação de leases vencidos sem varrer `processing` inteiro.
CREATE INDEX idx_event_outbox_lease
  ON event_outbox (status, lease_expires_at)
  WHERE lease_expires_at IS NOT NULL;

-- Idempotência dos efeitos: uma notificação gerada pela IA para o mesmo evento
-- não pode ser criada duas vezes quando o evento é reprocessado. `dedupe_key`
-- fica nulo nas notificações que não passam por essa política (conquistas,
-- família), preservando o comportamento atual delas.
ALTER TABLE notifications ADD COLUMN dedupe_key TEXT;
CREATE UNIQUE INDEX ux_notifications_user_dedupe
  ON notifications (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- `source_event` guarda o tipo do evento (contrato exposto pela API), então a
-- deduplicação usa uma chave própria com o id do evento de origem mais o
-- título. `dedupe_key` fica nulo nos insights criados fora do worker.
ALTER TABLE ai_insights ADD COLUMN dedupe_key TEXT;
CREATE UNIQUE INDEX ux_ai_insights_user_dedupe
  ON ai_insights (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
