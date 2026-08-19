import { Database } from 'bun:sqlite';
import { join } from 'node:path';

const sourcePath =
  process.env.OMM_SOURCE_DB || join(import.meta.dir, '../../mystery-clawer/data/mystery.db');
const d1Path = join(import.meta.dir, '../data/omm-d1.sqlite');
const source = new Database(sourcePath, { readonly: true });
const d1 = new Database(d1Path, { readonly: true });
const sourceLinks = source;

const predicates = [
  'author',
  'aozora_role',
  'publisher',
  'characters',
  'award_received',
  'series',
  'translator',
  'genre',
];
const distinctPairs = (db: Database, predicate: string): number => {
  const row = db
    .query(
      `SELECT COUNT(*) AS count FROM (
        SELECT DISTINCT subject_id, object_ref
        FROM facts
        WHERE predicate = ? AND object_ref IS NOT NULL AND object_ref != ''
      )`,
    )
    .get(predicate) as { count: number };
  return Number(row.count);
};

const entityCount = (db: Database, type: string): number => {
  const row = db.query('SELECT COUNT(*) AS count FROM entities WHERE type = ?').get(type) as {
    count: number;
  };
  return Number(row.count);
};

console.log('# Relationship coverage audit');
console.log(`source=${sourcePath}`);
console.log(`d1=${d1Path}`);
console.log('\n## Distinct relationship pairs');
console.log('| predicate | source | d1 | retention |');
console.log('| --- | ---: | ---: | ---: |');
for (const predicate of predicates) {
  const sourceCount = distinctPairs(source, predicate);
  const d1Count = distinctPairs(d1, predicate);
  const retention = sourceCount ? `${((d1Count / sourceCount) * 100).toFixed(2)}%` : 'n/a';
  console.log(`| ${predicate} | ${sourceCount} | ${d1Count} | ${retention} |`);
}

console.log('\n## Entity counts');
console.log('| type | source | d1 |');
console.log('| --- | ---: | ---: |');
for (const type of ['author', 'person', 'work', 'character', 'publisher', 'award', 'series']) {
  console.log(`| ${type} | ${entityCount(source, type)} | ${entityCount(d1, type)} |`);
}

const publisher = 'douban:p新星出版社';
const publisherWorks = (db: Database): number => {
  const row = db
    .query(
      `SELECT COUNT(DISTINCT subject_id) AS count
       FROM facts
       WHERE (
         (predicate = 'publisher' AND object_ref = ?)
         OR (predicate = 'publisher_name' AND object_value = '新星出版社')
       )`,
    )
    .get(publisher) as { count: number };
  return Number(row.count);
};
console.log('\n## Publisher fixture');
console.log(
  `| ${publisher} | ${publisherWorks(source)} source works | ${publisherWorks(d1)} d1 works |`,
);

const author = 'wd:Q18324726';
const authorWorks = (db: Database): number => {
  const row = db
    .query(
      `SELECT COUNT(DISTINCT subject_id) AS count
       FROM facts
       WHERE predicate IN ('author', 'aozora_role') AND object_ref = ?`,
    )
    .get(author) as { count: number };
  return Number(row.count);
};
console.log('\n## Author fixture');
console.log(
  `| ${author} 早坂吝 | ${authorWorks(source)} direct source works | ${authorWorks(d1)} d1 works |`,
);
const linkedAuthorSources = sourceLinks
  .query('SELECT source_id FROM entity_links WHERE target_id = ?')
  .all(author) as { source_id: string }[];
const linkedAuthorWorks = linkedAuthorSources.length
  ? Number(
      source
        .query(
          `SELECT COUNT(DISTINCT subject_id) AS count
           FROM facts
           WHERE predicate IN ('author', 'aozora_role') AND object_ref IN (${linkedAuthorSources.map(() => '?').join(',')})`,
        )
        .get(...linkedAuthorSources.map((row) => row.source_id)).count,
    )
  : 0;
console.log(`linked source works=${linkedAuthorWorks}`);

const characterStats = (db: Database): { total: number; isolated: number } => {
  const total = entityCount(db, 'character');
  const row = db
    .query(
      `SELECT COUNT(*) AS count
       FROM entities e
       WHERE e.type = 'character'
         AND NOT EXISTS (
           SELECT 1 FROM facts f
           WHERE (f.subject_id = e.id OR f.object_ref = e.id)
             AND f.object_ref IS NOT NULL AND f.object_ref != ''
         )`,
    )
    .get() as { count: number };
  return { total, isolated: Number(row.count) };
};
const sourceCharacters = characterStats(source);
const d1Characters = characterStats(d1);
console.log('\n## Character isolation');
console.log(`source=${sourceCharacters.total} total, ${sourceCharacters.isolated} isolated`);
console.log(`d1=${d1Characters.total} total, ${d1Characters.isolated} isolated`);
