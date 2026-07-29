CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  subscription_json TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  app_origin TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
  device_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  due_local TEXT NOT NULL,
  trigger_at TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  task_updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, task_id),
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS reminders_due_idx ON reminders(status, trigger_at);
