-- 004_habits.sql — hábitos, logs diários e gatilhos de substituição.
-- Forward-only: nunca edite esta migração depois de aplicada.

CREATE TABLE habits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  description TEXT,
  color TEXT CHECK (
    color IS NULL
    OR color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'
  ),
  habit_type TEXT NOT NULL CHECK (habit_type IN ('good', 'bad')),
  frequency_type TEXT NOT NULL CHECK (frequency_type IN ('daily', 'weekly', 'custom')),
  -- Array JSON de dias ISO (1 = segunda … 7 = domingo). `daily` não usa dias.
  days_of_week TEXT,
  daily_target INTEGER NOT NULL DEFAULT 1 CHECK (daily_target >= 1),
  target_unit TEXT,
  order_index INTEGER NOT NULL DEFAULT 0 CHECK (order_index >= 0),
  parent_habit_id TEXT REFERENCES habits (id) ON DELETE RESTRICT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (parent_habit_id IS NULL OR parent_habit_id <> id),
  CHECK (
    (frequency_type = 'daily' AND days_of_week IS NULL)
    OR (frequency_type IN ('weekly', 'custom') AND days_of_week IS NOT NULL)
  )
) STRICT;

CREATE TABLE habit_triggers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  bad_habit_id TEXT NOT NULL REFERENCES habits (id) ON DELETE RESTRICT,
  replacement_habit_id TEXT REFERENCES habits (id) ON DELETE SET NULL,
  trigger_description TEXT NOT NULL CHECK (length(trim(trigger_description)) BETWEEN 1 AND 500),
  alternative_action TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (replacement_habit_id IS NULL OR replacement_habit_id <> bad_habit_id)
) STRICT;

CREATE TABLE habit_logs (
  id TEXT PRIMARY KEY,
  habit_id TEXT NOT NULL REFERENCES habits (id) ON DELETE CASCADE,
  log_date TEXT NOT NULL CHECK (
    log_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  value INTEGER NOT NULL DEFAULT 1 CHECK (value >= 0),
  note TEXT,
  trigger_id TEXT REFERENCES habit_triggers (id) ON DELETE SET NULL,
  replacement_used INTEGER NOT NULL DEFAULT 0 CHECK (replacement_used IN (0, 1)),
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (habit_id, log_date)
) STRICT;

CREATE INDEX idx_habits_user_active
  ON habits (user_id, is_active, order_index);
CREATE INDEX idx_habits_user_parent
  ON habits (user_id, parent_habit_id)
  WHERE parent_habit_id IS NOT NULL;

CREATE INDEX idx_habit_triggers_user_active
  ON habit_triggers (user_id, created_at)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_habit_triggers_bad_habit
  ON habit_triggers (bad_habit_id)
  WHERE deleted_at IS NULL;

-- A unique (habit_id, log_date) já indexa a leitura por hábito e dia; este
-- índice cobre a listagem de logs ativos em ordem cronológica.
CREATE INDEX idx_habit_logs_habit_date_active
  ON habit_logs (habit_id, log_date)
  WHERE deleted_at IS NULL;
