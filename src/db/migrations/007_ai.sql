-- 007_ai.sql — outbox transacional, executor de IA, insights, feedback e embeddings.
-- Forward-only: nunca edite esta migração depois de aplicada.

-- IA é opt-in por usuário. O default é desligado; o evento só entra no outbox
-- quando o usuário autorizou e a IA está habilitada globalmente.
ALTER TABLE user_preferences
  ADD COLUMN ai_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (ai_enabled IN (0, 1));

CREATE TABLE event_outbox (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT,
  user_id TEXT NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  priority INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TEXT NOT NULL,
  locked_at TEXT,
  worker_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  processed_at TEXT,
  -- Estados terminais não mantêm lease; `processing` sempre tem dono.
  CHECK (
    (status = 'processing' AND locked_at IS NOT NULL AND worker_id IS NOT NULL)
    OR (status <> 'processing' AND locked_at IS NULL AND worker_id IS NULL)
  )
) STRICT;

-- Ordem de claim: prioridade, disponibilidade e idade.
CREATE INDEX idx_event_outbox_claim
  ON event_outbox (status, available_at, priority DESC, created_at);
CREATE INDEX idx_event_outbox_processing
  ON event_outbox (status, locked_at);
CREATE INDEX idx_event_outbox_user
  ON event_outbox (user_id, created_at DESC);

CREATE TABLE ai_action_logs (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  arguments TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  executed INTEGER NOT NULL CHECK (executed IN (0, 1)),
  execution_time_ms INTEGER NOT NULL DEFAULT 0 CHECK (execution_time_ms >= 0),
  error TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_ai_action_logs_event
  ON ai_action_logs (event_id, created_at DESC);
CREATE INDEX idx_ai_action_logs_user_tool
  ON ai_action_logs (user_id, tool, created_at DESC);

CREATE TABLE ai_insights (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (
    category IN (
      'finance', 'habit', 'security', 'investment',
      'recommendation', 'family', 'correlation'
    )
  ),
  severity TEXT NOT NULL CHECK (
    severity IN ('low', 'medium', 'high', 'critical')
  ),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  source_event TEXT,
  confidence REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_ai_insights_user_read_created
  ON ai_insights (user_id, is_read, created_at DESC);
CREATE INDEX idx_ai_insights_user_category
  ON ai_insights (user_id, category, created_at DESC);

CREATE TABLE ai_feedback (
  id TEXT PRIMARY KEY,
  insight_id TEXT NOT NULL REFERENCES ai_insights (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  rating TEXT NOT NULL CHECK (rating IN ('helpful', 'not_helpful')),
  comment TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (insight_id, user_id)
) STRICT;

CREATE TABLE embedding_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (
    source_type IN (
      'transaction', 'habit', 'habit_log', 'insight', 'goal', 'investment'
    )
  ),
  source_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding BLOB NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK (dimensions > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, source_type, source_id)
) STRICT;

CREATE INDEX idx_embedding_items_user_source
  ON embedding_items (user_id, source_type);

-- Bloqueio de IP acionado por tools de segurança. A checagem é feita com
-- expiração; nenhum endereço fica bloqueado para sempre.
CREATE TABLE ip_blocklist (
  id TEXT PRIMARY KEY,
  ip_address TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_ip_blocklist_expires ON ip_blocklist (expires_at);

-- Controle de disparo da correlação cross-domain por volume de eventos.
CREATE TABLE ai_correlation_state (
  user_id TEXT PRIMARY KEY REFERENCES user_profiles (id) ON DELETE CASCADE,
  last_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
