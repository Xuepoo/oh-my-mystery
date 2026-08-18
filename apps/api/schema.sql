-- Cloudflare D1 Schema for Oh My Mystery (OMM)

-- 1. Unified Entity Table
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  qid TEXT,
  type TEXT NOT NULL,
  names_json TEXT NOT NULL,
  bio TEXT,
  birth TEXT,
  death TEXT,
  country TEXT,
  source TEXT,
  quality INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_qid ON entities(qid);

-- 2. Facts / Directed Relational Edges Table
CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object_ref TEXT NOT NULL,
  object_value TEXT,
  qualifiers_json TEXT,
  source TEXT
);

CREATE INDEX IF NOT EXISTS idx_facts_sub ON facts(subject_id, predicate, object_ref);
CREATE INDEX IF NOT EXISTS idx_facts_obj ON facts(object_ref, predicate, subject_id);
CREATE INDEX IF NOT EXISTS idx_facts_pred ON facts(predicate);
CREATE UNIQUE INDEX IF NOT EXISTS idx_facts_logical_assertion
  ON facts(subject_id, predicate, object_ref, IFNULL(object_value, ''));

-- 3. Logical works and their source-specific edition entities
CREATE TABLE IF NOT EXISTS work_groups (
  id TEXT PRIMARY KEY,
  representative_id TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  author_ids_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS work_group_members (
  work_group_id TEXT NOT NULL,
  entity_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (work_group_id, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_work_group_members_group ON work_group_members(work_group_id);

-- 4. Normalized publication events / work editions
CREATE TABLE IF NOT EXISTS publication_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id TEXT NOT NULL,
  work_group_id TEXT,
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
CREATE INDEX IF NOT EXISTS idx_publication_events_group ON publication_events(work_group_id);
CREATE INDEX IF NOT EXISTS idx_publication_events_publisher ON publication_events(publisher_id);

-- 5. Top-N Precomputed Recommendations
CREATE TABLE IF NOT EXISTS recommendations (
  entity_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  score REAL NOT NULL,
  reason TEXT NOT NULL,
  rank INTEGER NOT NULL,
  PRIMARY KEY (entity_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_rec_lookup ON recommendations(entity_id, rank);

-- 4. Curated Chronicle Trails (Storytelling Routes)
CREATE TABLE IF NOT EXISTS chronicles (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title_json TEXT NOT NULL,
  description_json TEXT NOT NULL,
  steps_json TEXT NOT NULL
);

-- 5. Fast Search Index
CREATE TABLE IF NOT EXISTS search_index (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name_zh TEXT,
  name_en TEXT,
  name_ja TEXT,
  aliases_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_search_zh ON search_index(name_zh);
CREATE INDEX IF NOT EXISTS idx_search_en ON search_index(name_en);
CREATE INDEX IF NOT EXISTS idx_search_ja ON search_index(name_ja);

-- 6. FTS5 Trigram Search (substring matches for CJK + latin queries)
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  id UNINDEXED,
  content,
  tokenize = 'trigram'
);
