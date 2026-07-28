CREATE TABLE IF NOT EXISTS subscribers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  email      TEXT NOT NULL,
  source     TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribers_email ON subscribers (email);
