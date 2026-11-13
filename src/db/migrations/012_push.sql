-- Notificações push (Web Push + VAPID).
--
-- 1. `push_subscriptions` guarda o endpoint e as chaves de cada dispositivo.
--    Revogação é soft delete (`revoked_at`): o histórico do vínculo fica
--    auditável e o mesmo navegador pode voltar sem criar linha duplicada.
-- 2. `notifications` ganha o estado de entrega do push. O worker consome as
--    linhas `pending` com claim/lease, exatamente como faz com a outbox.
--
-- Nenhuma coluna de domínio é removida ou reescrita: apenas expansão.

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;

-- Um endpoint vivo pertence a um único usuário. O mesmo navegador pode entrar
-- com outra conta, então a linha é reatribuída em vez de duplicada.
CREATE UNIQUE INDEX ux_push_subscriptions_endpoint
  ON push_subscriptions (endpoint)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_push_subscriptions_user_alive
  ON push_subscriptions (user_id, revoked_at);

ALTER TABLE notifications ADD COLUMN push_state TEXT NOT NULL DEFAULT 'pending'
  CHECK (push_state IN ('pending', 'sent', 'skipped', 'failed'));

ALTER TABLE notifications ADD COLUMN push_attempts INTEGER NOT NULL DEFAULT 0
  CHECK (push_attempts >= 0);

ALTER TABLE notifications ADD COLUMN push_last_error TEXT;
ALTER TABLE notifications ADD COLUMN push_sent_at TEXT;

-- Claim da entrega corrente; o token impede que um worker que perdeu a posse
-- sobrescreva o resultado de outro.
ALTER TABLE notifications ADD COLUMN push_claim_token TEXT;
ALTER TABLE notifications ADD COLUMN push_claim_expires_at TEXT;

-- O `ADD COLUMN` marca as linhas existentes como `pending`. Elas são
-- históricas: sem este UPDATE o primeiro boot do worker dispararia push para
-- todo o histórico de notificações do usuário.
UPDATE notifications SET push_state = 'skipped';

-- Índice parcial: o dispatcher nunca varre o histórico nem linhas terminais.
CREATE INDEX idx_notifications_push_pending
  ON notifications (created_at)
  WHERE push_state = 'pending';
