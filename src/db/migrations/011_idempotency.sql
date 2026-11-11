-- Fase 14: idempotência de escritas (Idempotency-Key).
--
-- Armazena respostas de requisições mutáveis (POST/PUT/PATCH/DELETE) por
-- chave de idempotência, para que reenvios com a mesma chave devolvam o
-- resultado em cache em vez de reexecutar a operação. Isso permite que o
-- cliente faça retry seguro em caso de falha de rede ou timeout.
--
-- As entradas expiram após `IDEMPOTENCY_TTL_HOURS` (padrão 24h) e são
-- removidas pela manutenção operacional.

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('POST', 'PUT', 'PATCH', 'DELETE')),
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  response_body TEXT NOT NULL DEFAULT '{}',
  response_headers TEXT, -- JSON serializado dos cabeçalhos de resposta
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_user_expires
  ON idempotency_keys(user_id, expires_at);
