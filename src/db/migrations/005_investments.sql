-- 005_investments.sql — ativos, operações, cotações e performance.
-- Forward-only: nunca edite esta migração depois de aplicada.

CREATE TABLE investments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  ticker TEXT NOT NULL CHECK (length(trim(ticker)) BETWEEN 1 AND 20),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  -- Classe livre (ex.: stock, fund, crypto): o plano não fixa um enum e a
  -- liberdade evita bloquear novas classes de ativos.
  asset_class TEXT NOT NULL CHECK (length(trim(asset_class)) BETWEEN 1 AND 40),
  currency_code TEXT NOT NULL CHECK (length(currency_code) = 3),
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- O ticker é único por usuário apenas entre ativos ativos; um ativo removido
-- não impede recadastrar o mesmo ticker.
CREATE UNIQUE INDEX idx_investments_user_ticker
  ON investments (user_id, ticker COLLATE NOCASE)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_investments_user_created
  ON investments (user_id, created_at)
  WHERE deleted_at IS NULL;

CREATE TABLE investment_transactions (
  id TEXT PRIMARY KEY,
  investment_id TEXT NOT NULL REFERENCES investments (id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  operation_type TEXT NOT NULL CHECK (
    operation_type IN ('buy', 'sell', 'dividend', 'fee')
  ),
  -- Quantidade pode ser fracionária (ações fracionadas, cripto); preços e
  -- taxas permanecem inteiros em minor units.
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_price_minor INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_minor >= 0),
  fees_minor INTEGER NOT NULL DEFAULT 0 CHECK (fees_minor >= 0),
  operation_date TEXT NOT NULL CHECK (
    operation_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  created_at TEXT NOT NULL,
  CHECK (operation_type <> 'fee' OR fees_minor > 0),
  CHECK (operation_type NOT IN ('buy', 'sell') OR unit_price_minor > 0)
) STRICT;

CREATE INDEX idx_investment_transactions_investment
  ON investment_transactions (investment_id, operation_date, created_at);
CREATE INDEX idx_investment_transactions_account
  ON investment_transactions (account_id);

CREATE TABLE investment_quotes (
  id TEXT PRIMARY KEY,
  investment_id TEXT NOT NULL REFERENCES investments (id) ON DELETE CASCADE,
  price_minor INTEGER NOT NULL CHECK (price_minor > 0),
  quoted_at TEXT NOT NULL,
  source TEXT CHECK (
    source IS NULL OR length(trim(source)) BETWEEN 1 AND 60
  ),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_investment_quotes_investment
  ON investment_quotes (investment_id, quoted_at DESC, created_at DESC);
