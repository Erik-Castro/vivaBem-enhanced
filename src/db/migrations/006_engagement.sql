-- 006_engagement.sql — catálogo de conquistas, progresso do usuário e notificações.
-- Forward-only: nunca edite esta migração depois de aplicada.

CREATE TABLE achievements (
  id TEXT PRIMARY KEY,
  -- O título é a chave natural do catálogo: o seed é idempotente por título.
  title TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN ('finance', 'habit', 'investment', 'system')
  ),
  points_reward INTEGER NOT NULL DEFAULT 0 CHECK (points_reward >= 0),
  badge_icon_url TEXT,
  -- Nome da regra no catálogo declarativo (`TOTAL_TRANSACTIONS_COUNT`, ...).
  criteria_rule TEXT NOT NULL,
  -- Parâmetros JSON da regra, para conquistas que compartilham o mesmo
  -- critério mas variam um detalhe (ex.: dia da semana).
  criteria_params TEXT NOT NULL DEFAULT '{}',
  target_metric INTEGER NOT NULL CHECK (target_metric >= 0),
  is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1)),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_achievements_rule ON achievements (criteria_rule);

CREATE TABLE user_achievements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL REFERENCES achievements (id) ON DELETE CASCADE,
  current_progress INTEGER NOT NULL DEFAULT 0 CHECK (current_progress >= 0),
  is_unlocked INTEGER NOT NULL DEFAULT 0 CHECK (is_unlocked IN (0, 1)),
  unlocked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, achievement_id),
  CHECK (
    (is_unlocked = 0 AND unlocked_at IS NULL)
    OR (is_unlocked = 1 AND unlocked_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_user_achievements_user_unlocked
  ON user_achievements (user_id, is_unlocked, unlocked_at DESC);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN ('finance', 'habit', 'security', 'system', 'investment', 'family')
  ),
  severity TEXT NOT NULL DEFAULT 'low'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  link TEXT,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  created_at TEXT NOT NULL
) STRICT;

-- Cobre a listagem cronológica e a contagem de não lidas por usuário.
CREATE INDEX idx_notifications_user_read_created
  ON notifications (user_id, is_read, created_at DESC);
