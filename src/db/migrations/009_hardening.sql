-- Fase 9: índices para manutenção e limpeza periódica.
--
-- A limpeza de sessões expiradas filtra só por `expires_at`; o índice de
-- `user_sessions` começa por `user_id`, então não serve para esse DELETE.
CREATE INDEX idx_user_sessions_expires ON user_sessions (expires_at);

-- Eventos concluídos são removidos por idade; separar esse índice do índice de
-- claim evita varrer todo o status `completed` para achar os antigos.
CREATE INDEX idx_event_outbox_cleanup
  ON event_outbox (status, processed_at)
  WHERE processed_at IS NOT NULL;
