-- Fase 8: dados e colaboração.
--
-- `family_links` guarda o convite e o vínculo entre dois usuários. O par
-- ordenado (requester, addressee) é único, mas a checagem de "um vínculo por
-- usuário" é feita no service dentro da transação, porque um índice parcial
-- sobre duas colunas não expressa essa regra.

CREATE TABLE family_links (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  addressee_id TEXT NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'revoked')),
  created_at TEXT NOT NULL,
  responded_at TEXT,
  CHECK (requester_id <> addressee_id),
  CHECK (
    (status = 'pending' AND responded_at IS NULL)
    OR (status <> 'pending' AND responded_at IS NOT NULL)
  )
) STRICT;

-- Um único registro por par não ordenado: recusar/revogar e convidar de novo
-- reabre a mesma linha em vez de acumular histórico duplicado.
CREATE UNIQUE INDEX ux_family_links_pair
  ON family_links (min(requester_id, addressee_id), max(requester_id, addressee_id));

CREATE INDEX idx_family_links_requester
  ON family_links (requester_id, status);
CREATE INDEX idx_family_links_addressee
  ON family_links (addressee_id, status);

-- Deduplicação de import: o hash é calculado sobre a conta + identificador
-- externo (FITID do OFX) ou, na ausência dele, sobre data/valor/tipo/descrição.
-- O índice é parcial para não afetar transações criadas manualmente, que têm
-- `import_hash` nulo.
CREATE UNIQUE INDEX ux_transactions_import_hash
  ON transactions (account_id, import_hash)
  WHERE import_hash IS NOT NULL AND deleted_at IS NULL;
