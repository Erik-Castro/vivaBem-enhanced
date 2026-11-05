-- 002_finance.sql — contas, cartões, categorias, transações e parcelas.
-- Forward-only: nunca edite esta migração depois de aplicada.

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (
    type IN ('checking', 'savings', 'credit_card', 'investment', 'cash')
  ),
  currency_code TEXT NOT NULL CHECK (length(currency_code) = 3),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE credit_card_details (
  account_id TEXT PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  closing_day INTEGER NOT NULL CHECK (closing_day BETWEEN 1 AND 31),
  due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  limit_minor INTEGER NOT NULL DEFAULT 0 CHECK (limit_minor >= 0)
) STRICT;

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES categories (id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
  color TEXT CHECK (
    color IS NULL OR color GLOB
      '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]'
  ),
  icon TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- `amount_minor` é sempre positivo em income/expense. Nas transferências, as
-- duas pernas usam `type = 'transfer'`: a saída é negativa e a entrada positiva,
-- de modo que o saldo da conta é a soma direta dos valores.
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  category_id TEXT REFERENCES categories (id) ON DELETE RESTRICT,
  transfer_group_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
  amount_minor INTEGER NOT NULL,
  currency_code TEXT NOT NULL CHECK (length(currency_code) = 3),
  description TEXT,
  transaction_date TEXT NOT NULL CHECK (
    transaction_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  is_cleared INTEGER NOT NULL DEFAULT 0 CHECK (is_cleared IN (0, 1)),
  external_id TEXT,
  import_hash TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (type = 'transfer' AND transfer_group_id IS NOT NULL AND category_id IS NULL
      AND amount_minor <> 0)
    OR (type IN ('income', 'expense') AND transfer_group_id IS NULL AND amount_minor > 0)
  )
) STRICT;

CREATE TABLE credit_card_transactions (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions (id) ON DELETE CASCADE,
  installment_number INTEGER NOT NULL CHECK (installment_number >= 1),
  total_installments INTEGER NOT NULL CHECK (total_installments >= 1),
  installment_group_id TEXT NOT NULL,
  CHECK (installment_number <= total_installments)
) STRICT;

CREATE INDEX idx_accounts_user_active ON accounts (user_id, is_active);
CREATE UNIQUE INDEX idx_accounts_user_name_active
  ON accounts (user_id, name) WHERE is_active = 1;

CREATE INDEX idx_categories_user_type_active ON categories (user_id, type, is_active);
CREATE INDEX idx_categories_user_parent ON categories (user_id, parent_id, is_active);
CREATE UNIQUE INDEX idx_categories_user_parent_name_active
  ON categories (user_id, IFNULL(parent_id, ''), name) WHERE is_active = 1;

CREATE INDEX idx_transactions_account_date
  ON transactions (account_id, transaction_date DESC, id DESC);
CREATE INDEX idx_transactions_category_date
  ON transactions (category_id, transaction_date DESC, id DESC);
CREATE INDEX idx_transactions_date ON transactions (transaction_date DESC, id DESC);
CREATE INDEX idx_transactions_transfer_group
  ON transactions (transfer_group_id) WHERE transfer_group_id IS NOT NULL;

CREATE INDEX idx_credit_card_transactions_group
  ON credit_card_transactions (installment_group_id);
