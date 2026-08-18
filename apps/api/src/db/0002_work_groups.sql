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

ALTER TABLE publication_events ADD COLUMN work_group_id TEXT;
CREATE INDEX IF NOT EXISTS idx_publication_events_group ON publication_events(work_group_id);

DELETE FROM facts
 WHERE id NOT IN (
   SELECT MIN(id)
     FROM facts
    GROUP BY subject_id, predicate, object_ref, IFNULL(object_value, '')
 );
CREATE UNIQUE INDEX IF NOT EXISTS idx_facts_logical_assertion
  ON facts(subject_id, predicate, object_ref, IFNULL(object_value, ''));
