-- 003_planning.sql — recorrências, orçamentos e metas.
-- Forward-only: nunca edite esta migração depois de aplicada.

CREATE TABLE recurring_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  category_id TEXT REFERENCES categories (id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency_code TEXT NOT NULL CHECK (length(currency_code) = 3),
  description TEXT,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  interval INTEGER NOT NULL DEFAULT 1 CHECK (interval >= 1),
  day_of_month INTEGER CHECK (day_of_month BETWEEN 1 AND 31),
  start_date TEXT NOT NULL CHECK (
    start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  end_date TEXT CHECK (
    end_date IS NULL
    OR end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  next_occurrence TEXT NOT NULL CHECK (
    next_occurrence GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK (
    (frequency IN ('daily', 'weekly') AND day_of_month IS NULL)
    OR (frequency IN ('monthly', 'yearly') AND day_of_month IS NOT NULL)
  )
) STRICT;

CREATE TABLE recurring_occurrences (
  id TEXT PRIMARY KEY,
  recurring_transaction_id TEXT NOT NULL
    REFERENCES recurring_transactions (id) ON DELETE CASCADE,
  occurrence_date TEXT NOT NULL CHECK (
    occurrence_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  transaction_id TEXT NOT NULL UNIQUE
    REFERENCES transactions (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE (recurring_transaction_id, occurrence_date)
) STRICT;

CREATE TABLE budgets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories (id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  limit_minor INTEGER NOT NULL CHECK (limit_minor > 0),
  currency_code TEXT NOT NULL CHECK (length(currency_code) = 3),
  period_type TEXT NOT NULL CHECK (period_type IN ('monthly', 'yearly', 'custom')),
  start_date TEXT NOT NULL CHECK (
    start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  end_date TEXT CHECK (
    end_date IS NULL
    OR end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  alert_threshold INTEGER NOT NULL DEFAULT 80
    CHECK (alert_threshold BETWEEN 1 AND 100),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK (
    (period_type = 'custom' AND end_date IS NOT NULL)
    OR (period_type <> 'custom' AND end_date IS NULL)
  )
) STRICT;

CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  target_account_id TEXT REFERENCES accounts (id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  target_amount_minor INTEGER NOT NULL CHECK (target_amount_minor > 0),
  currency_code TEXT NOT NULL CHECK (length(currency_code) = 3),
  target_date TEXT CHECK (
    target_date IS NULL
    OR target_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE goal_contributions (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals (id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts (id) ON DELETE RESTRICT,
  transaction_id TEXT REFERENCES transactions (id) ON DELETE SET NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  contribution_date TEXT NOT NULL CHECK (
    contribution_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  note TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL
) STRICT;

-- A coluna foi adiada na Fase 2; agora a recorrência pode apontar para a
-- transação que a originou. `ON DELETE SET NULL` preserva o histórico.
ALTER TABLE transactions
  ADD COLUMN recurring_transaction_id TEXT
    REFERENCES recurring_transactions (id) ON DELETE SET NULL;

CREATE INDEX idx_recurring_user_active
  ON recurring_transactions (user_id, is_active, next_occurrence);
CREATE INDEX idx_recurring_due
  ON recurring_transactions (next_occurrence) WHERE is_active = 1;
CREATE INDEX idx_recurring_occurrences_date
  ON recurring_occurrences (recurring_transaction_id, occurrence_date);
CREATE INDEX idx_transactions_recurring
  ON transactions (recurring_transaction_id)
  WHERE recurring_transaction_id IS NOT NULL;

CREATE INDEX idx_budgets_user_active ON budgets (user_id, is_active, start_date);
CREATE INDEX idx_budgets_user_category ON budgets (user_id, category_id);

CREATE INDEX idx_goals_user_status ON goals (user_id, status);
CREATE INDEX idx_goal_contributions_goal_date
  ON goal_contributions (goal_id, contribution_date)
  WHERE deleted_at IS NULL;
