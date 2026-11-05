-- 001_core.sql — identidade, credenciais, preferências, sessões e auditoria de auth.
-- Forward-only: nunca edite esta migração depois de aplicada.

CREATE TABLE user_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar_url TEXT,
  subscription_tier TEXT NOT NULL DEFAULT 'free'
    CHECK (subscription_tier IN ('free', 'premium')),
  setup_completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE user_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES user_profiles (id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash TEXT NOT NULL,
  password_algorithm TEXT NOT NULL DEFAULT 'argon2id',
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES user_profiles (id) ON DELETE CASCADE,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  base_currency TEXT NOT NULL DEFAULT 'BRL' CHECK (length(base_currency) = 3),
  locale TEXT NOT NULL DEFAULT 'pt-BR',
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  token_family_id TEXT NOT NULL,
  rotated_from TEXT REFERENCES user_sessions (id) ON DELETE SET NULL,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
) STRICT;

CREATE TABLE auth_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES user_profiles (id) ON DELETE SET NULL,
  email TEXT,
  type TEXT NOT NULL CHECK (
    type IN ('login_success', 'login_failed', 'refresh', 'logout', 'reuse_detected')
  ),
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_user_sessions_user ON user_sessions (user_id, expires_at);
CREATE INDEX idx_user_sessions_family ON user_sessions (token_family_id);
CREATE INDEX idx_auth_events_email ON auth_events (email, created_at DESC);
CREATE INDEX idx_auth_events_ip ON auth_events (ip_address, created_at DESC);
CREATE INDEX idx_auth_events_user ON auth_events (user_id, created_at DESC);
