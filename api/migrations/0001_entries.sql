CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  client TEXT NOT NULL,
  initials TEXT NOT NULL,
  fields TEXT NOT NULL,
  rank_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (game, submission_id)
);

CREATE INDEX IF NOT EXISTS idx_entries_board ON entries (game, rank_key, id);
