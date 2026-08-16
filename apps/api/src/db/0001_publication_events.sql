CREATE TABLE IF NOT EXISTS publication_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id TEXT NOT NULL,
  publisher_id TEXT,
  translator_ids_json TEXT NOT NULL DEFAULT '[]',
  publication_date TEXT,
  isbn TEXT,
  language TEXT,
  region TEXT,
  edition_type TEXT,
  source TEXT,
  provenance_json TEXT NOT NULL DEFAULT '{}',
  fingerprint TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_publication_events_work ON publication_events(work_id);
CREATE INDEX IF NOT EXISTS idx_publication_events_publisher ON publication_events(publisher_id);
