import { describe, expect, test } from 'bun:test';
import { buildInsertSql } from './d1-import-utils';

describe('buildInsertSql', () => {
  test('names columns so local and migrated D1 column order may differ', () => {
    expect(
      buildInsertSql('publication_events', ['id', 'work_group_id', 'fingerprint'], {
        id: 7,
        fingerprint: "edition's fingerprint",
        work_group_id: null,
      }),
    ).toBe(
      "INSERT OR REPLACE INTO publication_events (id,work_group_id,fingerprint) VALUES(7,NULL,'edition''s fingerprint');",
    );
  });
});
