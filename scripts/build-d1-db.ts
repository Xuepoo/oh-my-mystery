import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChronicleTrail } from '../packages/shared/src/types';
import { applyOverrides, cleanNames, isJunkNames, namesToJson } from './clean-labels';

const SOURCE_DB_PATH = join(import.meta.dir, '../../mystery-clawer/data/mystery.db');
const OUT_DIR = join(import.meta.dir, '../data');

if (!existsSync(OUT_DIR)) {
  mkdirSync(OUT_DIR, { recursive: true });
}

const DB_PATH = join(OUT_DIR, 'omm-d1.sqlite');
if (existsSync(DB_PATH)) {
  try {
    Bun.spawnSync(['rm', '-f', DB_PATH]);
  } catch {}
}

const db = new Database(DB_PATH);

// 1. Initialize schema
const schemaSql = readFileSync(join(import.meta.dir, '../apps/api/schema.sql'), 'utf-8');
db.run(schemaSql);

console.log('📦 Loading entities, facts, and links from mystery.db...');
const srcDb = new Database(SOURCE_DB_PATH);

// Load entity links mapping
const linkMap = new Map<string, string>();
const linkRows = srcDb.query('SELECT source_id, target_id FROM entity_links').all() as any[];
for (const row of linkRows) {
  if (row.source_id && row.target_id) {
    linkMap.set(row.source_id, row.target_id);
  }
}
console.log(`✓ Loaded ${linkMap.size} entity links`);

function resolveLink(id: string): string {
  let cur = id;
  const seen = new Set<string>();
  while (linkMap.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    cur = linkMap.get(cur)!;
  }
  return cur;
}

function normPublisherName(raw: string): string {
  let s = raw.normalize('NFKC').trim().toLowerCase();
  s = s.replace(/^(株式会社|股份公司|\(株\)|（株）)/u, '');
  s = s.replace(/[\s（）()·•・,，.。]/g, '');
  return s;
}

function stripPublisherSuffix(s: string): string {
  return s.replace(/(出版社|出版有限公司|出版公司|出版集团|出版)$/u, '');
}

function djb2Hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return h >>> 0;
}

function matchPublisher(value: string): string | null {
  const candidates = [value, ...value.split(/[、，,／/・]/u)]
    .map(normPublisherName)
    .filter(Boolean);
  for (const key of candidates) {
    const direct = publisherByName.get(key);
    if (direct) return direct;
    const stripped = stripPublisherSuffix(key);
    if (stripped && stripped !== key) {
      const hit = publisherByName.get(stripped);
      if (hit) return hit;
    }
    if (key.length >= 4) {
      for (const [name, id] of publisherByName) {
        if (name.length >= 4 && (name.includes(key) || key.includes(name))) return id;
      }
    }
  }
  return null;
}

// Filter entities to mystery/detective core domain (Wikidata + MWJ + Edgar + CWA + Aozora + Douban core)
const entityRows = srcDb
  .query(
    `
  SELECT id, qid, type, names_json, bio, birth, death, country, source, quality
  FROM entities
  WHERE type IN ('author', 'work', 'award', 'character', 'series', 'publisher', 'genre')
    AND (
      id LIKE 'wd:%'
      OR id LIKE 'club:%'
      OR id LIKE 'edgar:%'
      OR id LIKE 'cwa:%'
      OR id LIKE 'aozora:%'
      OR id LIKE 'douban:%'
      OR id LIKE 'tuiliz:%'
      OR id LIKE 'gutenberg:%'
    )
`,
  )
  .all() as any[];

console.log(`✓ Selected ${entityRows.length} core domain entities`);

const entityMap = new Map<string, any>();
for (const e of entityRows) {
  entityMap.set(e.id, e);
}

// 2. Insert Entities and Search Index
console.log('💾 Inserting entities and search index into D1 SQLite...');
const insertEntity = db.prepare(`
  INSERT OR REPLACE INTO entities (id, qid, type, names_json, bio, birth, death, country, source, quality)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertSearch = db.prepare(`
  INSERT OR REPLACE INTO search_index (id, type, name_zh, name_en, name_ja, aliases_text)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const insertSearchFts = db.prepare(`
  INSERT OR REPLACE INTO search_fts (id, content) VALUES (?, ?)
`);

// Separator-stripped variant so trigram FTS matches queries typed without
// middle dots (e.g. 埃勒里奎因 vs stored 埃勒里·奎因).
function normalizeForFts(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\s·・•.\-—_–|]+/g, '')
    .toLowerCase();
}

const aliasMerge = new Map<string, string[]>();
let mergedEntityCount = 0;

db.transaction(() => {
  for (const e of entityMap.values()) {
    const cleaned = applyOverrides(e.id, cleanNames(e.names_json));
    if (isJunkNames(cleaned, e.type)) {
      entityMap.delete(e.id);
      continue;
    }

    // Cross-source entity merging: entities linked to a canonical Wikidata
    // node are folded into it (labels become extra search aliases).
    const canonical = resolveLink(e.id);
    if (canonical !== e.id) {
      const labels = cleaned.labels;
      const extras: string[] = [];
      for (const key of ['zh', 'zh-cn', 'zh-tw', 'zh-hk', 'en', 'ja']) {
        const v = labels[key];
        if (v && !extras.includes(v)) extras.push(v);
      }
      for (const arr of Object.values(cleaned.aliases)) {
        if (Array.isArray(arr)) {
          for (const a of arr) {
            if (a && !extras.includes(a)) extras.push(a);
          }
        }
      }
      const existing = aliasMerge.get(canonical) || [];
      for (const ex of extras) {
        if (!existing.includes(ex)) existing.push(ex);
      }
      aliasMerge.set(canonical, existing);
      entityMap.delete(e.id);
      mergedEntityCount += 1;
      continue;
    }

    insertEntity.run(
      e.id,
      e.qid || null,
      e.type,
      namesToJson(cleaned),
      e.bio || null,
      e.birth || null,
      e.death || null,
      e.country || null,
      e.source || 'wikidata',
      e.quality || 1,
    );

    const labels = cleaned.labels;
    const allAliases: string[] = [];
    for (const arr of Object.values(cleaned.aliases)) {
      if (Array.isArray(arr)) allAliases.push(...arr);
    }

    const nameZh = labels['zh'] || labels['zh-cn'] || labels['zh-tw'] || labels['zh-hk'] || null;
    insertSearch.run(
      e.id,
      e.type,
      nameZh,
      labels['en'] || null,
      labels['ja'] || null,
      allAliases.join(' | ') || null,
    );
    insertSearchFts.run(
      e.id,
      [nameZh, labels['en'], labels['ja'], ...allAliases].filter(Boolean).join(' '),
    );
  }

  for (const [target, extras] of aliasMerge) {
    const row: any = db.query('SELECT aliases_text FROM search_index WHERE id = ?').get(target);
    if (!row) continue;
    const existing = (row.aliases_text || '').split(' | ').filter(Boolean);
    for (const ex of extras) {
      if (!existing.includes(ex)) existing.push(ex);
    }
    db.run('UPDATE search_index SET aliases_text = ? WHERE id = ?', [existing.join(' | '), target]);
  }
})();

console.log(`✓ Merged ${mergedEntityCount} linked source entities into canonical nodes`);

// 2b. Rebuild FTS content with separator-stripped variants for CJK queries
console.log('🔎 Rebuilding search_fts with normalized variants...');
const rebuildFts = db.prepare('UPDATE search_fts SET content = ? WHERE id = ?');
const ftsRows = db
  .query('SELECT id, name_zh, name_en, name_ja, aliases_text FROM search_index')
  .all() as {
  id: string;
  name_zh: string | null;
  name_en: string | null;
  name_ja: string | null;
  aliases_text: string | null;
}[];
db.transaction(() => {
  for (const row of ftsRows) {
    const parts = [row.name_zh, row.name_en, row.name_ja, row.aliases_text].filter(
      Boolean,
    ) as string[];
    const variants = [...new Set(parts.map(normalizeForFts))].filter(Boolean);
    rebuildFts.run([...parts, ...variants].join(' '), row.id);
  }
})();

// 3. Load and Insert Facts
console.log('💾 Loading and inserting facts into D1 SQLite...');
const factsRows = srcDb
  .query(
    `
  SELECT subject_id, predicate, object_ref, object_value, qualifiers_json, source
  FROM facts
  WHERE predicate NOT IN ('wikidata_id', 'douban_meta')
`,
  )
  .all() as any[];

const insertFact = db.prepare(`
  INSERT INTO facts (subject_id, predicate, object_ref, object_value, qualifiers_json, source)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const validFacts: any[] = [];
const outEdges = new Map<string, { predicate: string; target: string }[]>();
const inEdges = new Map<string, { predicate: string; source: string }[]>();

// Publisher entity-ization: index publisher entity names, then rewrite
// publisher_name string facts into publisher edges when a match exists.
const publisherByName = new Map<string, string>();
for (const e of entityMap.values()) {
  if (e.type !== 'publisher') continue;
  const cleaned = cleanNames(e.names_json);
  for (const v of Object.values(cleaned.labels)) {
    const key = normPublisherName(v);
    if (key && !publisherByName.has(key)) publisherByName.set(key, e.id);
  }
  for (const arr of Object.values(cleaned.aliases)) {
    if (!Array.isArray(arr)) continue;
    for (const a of arr) {
      const key = normPublisherName(a);
      if (key && !publisherByName.has(key)) publisherByName.set(key, e.id);
    }
  }
}
let publisherMatched = 0;
let publisherUnmatched = 0;
let publisherSynthesized = 0;

// Synthesize publisher entities for publisher_name strings that have no
// existing publisher entity (common aozora/douban publishers like 筑摩書房).
{
  const needed = new Map<string, { id: string; label: string }>();
  const seenKeys = new Set<string>();
  for (const f of factsRows) {
    if (f.predicate !== 'publisher_name' || !f.object_value) continue;
    if (!entityMap.has(resolveLink(f.subject_id))) continue;
    const label = String(f.object_value).trim();
    if (!label) continue;
    const key = normPublisherName(label);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    if (matchPublisher(label)) continue;
    const hash = djb2Hash(key).toString(16).padStart(12, '0');
    needed.set(key, { id: `pname:${hash}`, label });
  }
  if (needed.size > 0) {
    db.transaction(() => {
      for (const { id, label } of needed.values()) {
        insertEntity.run(
          id,
          null,
          'publisher',
          namesToJson({ labels: { ja: label }, aliases: {} }),
          null,
          null,
          null,
          null,
          'synthesized',
          1,
        );
        insertSearch.run(id, 'publisher', null, null, label, null);
        insertSearchFts.run(id, label);
        publisherByName.set(normPublisherName(label), id);
        entityMap.set(id, {
          id,
          qid: null,
          type: 'publisher',
          names_json: namesToJson({ labels: { ja: label }, aliases: {} }),
          bio: null,
          birth: null,
          death: null,
          country: null,
          source: 'synthesized',
          quality: 1,
        });
        publisherSynthesized += 1;
      }
    })();
  }
}

db.transaction(() => {
  for (const f of factsRows) {
    // Canonicalize IDs if linked
    const sub = resolveLink(f.subject_id);
    let obj = f.object_ref ? resolveLink(f.object_ref) : f.object_ref;

    // Rewrite publisher_name string facts into publisher entity edges
    if (f.predicate === 'publisher_name' && f.object_value) {
      const pubId = matchPublisher(f.object_value);
      if (pubId && entityMap.has(pubId)) {
        f.predicate = 'publisher';
        f.object_value = null;
        obj = pubId;
        publisherMatched += 1;
      } else {
        obj = '';
        publisherUnmatched += 1;
      }
    }

    if (entityMap.has(sub) && (entityMap.has(obj) || !f.object_ref)) {
      validFacts.push({ ...f, subject_id: sub, object_ref: obj });
      insertFact.run(
        sub,
        f.predicate,
        obj,
        f.object_value || null,
        f.qualifiers_json || null,
        f.source || null,
      );

      const outs = outEdges.get(sub) || [];
      outs.push({ predicate: f.predicate, target: obj });
      outEdges.set(sub, outs);

      if (obj) {
        const inns = inEdges.get(obj) || [];
        inns.push({ predicate: f.predicate, source: sub });
        inEdges.set(obj, inns);
      }
    }
  }
})();

console.log(
  `✓ Inserted ${validFacts.length} connected facts (publisher entity-ized: ${publisherMatched} matched, ${publisherUnmatched} unmatched)`,
);

// 4. Compute Top-N Recommendations
console.log('🧠 Computing Graph-based Recommendations...');
const insertRec = db.prepare(`
  INSERT OR REPLACE INTO recommendations (entity_id, target_id, score, reason, rank)
  VALUES (?, ?, ?, ?, ?)
`);

db.transaction(() => {
  for (const [id, entity] of entityMap.entries()) {
    const scores = new Map<string, { score: number; reason: string }>();

    // Direct connections
    const outs = outEdges.get(id) || [];
    for (const edge of outs) {
      if (edge.predicate === 'author' || edge.predicate === 'P50') {
        scores.set(edge.target, { score: 0.95, reason: '原著作者' });
      } else if (
        edge.predicate === 'award' ||
        edge.predicate === 'award_received' ||
        edge.predicate === 'P166'
      ) {
        scores.set(edge.target, { score: 0.85, reason: '相关推理奖项' });
      } else if (edge.predicate === 'character' || edge.predicate === 'P674') {
        scores.set(edge.target, { score: 0.8, reason: '登场名侦探/角色' });
      } else if (edge.predicate === 'series' || edge.predicate === 'P179') {
        scores.set(edge.target, { score: 0.85, reason: '同系列作品' });
      }
    }

    const inns = inEdges.get(id) || [];
    for (const edge of inns) {
      if (edge.predicate === 'author' || edge.predicate === 'P50') {
        scores.set(edge.source, { score: 0.9, reason: '代表名作' });
      } else if (edge.predicate === 'character' || edge.predicate === 'P674') {
        scores.set(edge.source, { score: 0.85, reason: '登场名作' });
      }
    }

    // 2-Hop Co-occurrence (e.g. Co-award authors, shared series)
    if (entity.type === 'author') {
      const works = inns
        .filter((e) => e.predicate === 'author' || e.predicate === 'P50')
        .map((e) => e.source);
      for (const w of works) {
        const awards = (outEdges.get(w) || [])
          .filter(
            (e) =>
              e.predicate === 'award' || e.predicate === 'award_received' || e.predicate === 'P166',
          )
          .map((e) => e.target);
        for (const aw of awards) {
          const coWorks = (inEdges.get(aw) || [])
            .filter(
              (e) =>
                e.predicate === 'award' ||
                e.predicate === 'award_received' ||
                e.predicate === 'P166',
            )
            .map((e) => e.source);
          for (const cw of coWorks) {
            const coAuthorEdge = (outEdges.get(cw) || []).find(
              (e) => e.predicate === 'author' || e.predicate === 'P50',
            );
            if (coAuthorEdge && coAuthorEdge.target !== id) {
              const current = scores.get(coAuthorEdge.target);
              if (!current || current.score < 0.75) {
                scores.set(coAuthorEdge.target, {
                  score: 0.75,
                  reason: '共同入围/斩获推理大奖',
                });
              }
            }
          }
        }
      }
    }

    // Sort and take top 10
    const sorted = [...scores.entries()]
      .filter(([targetId]) => entityMap.has(targetId))
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, 10);

    let rank = 1;
    for (const [targetId, item] of sorted) {
      insertRec.run(id, targetId, item.score, item.reason, rank++);
    }
  }
})();

// 5. Insert Chronicle Trails
console.log('📜 Seeding Chronicle Trails...');
const trails: ChronicleTrail[] = [
  {
    id: 'trail-golden-age',
    slug: 'golden-age-trio',
    title: {
      zh: '黄金时代三巨头与古典本格',
      en: 'Golden Age of Detective Fiction',
      ja: '本格ミステリ黄金時代',
    },
    description: {
      zh: '从阿瑟·柯南·道尔开辟神探传统，到阿加莎、卡尔确立密室讲义、读者挑战书与严密逻辑解谜的巅峰时代。',
      en: 'From Arthur Conan Doyle to Agatha Christie and John Dickson Carr, the golden era of classical puzzle plots.',
      ja: 'コナン・ドイルからクリスティ、カーへと続く古典本格の黄金期。',
    },
    steps: [
      {
        id: 'step-doyle',
        title: { zh: '神探起源：阿瑟·柯南·道尔', en: 'The Origin: Arthur Conan Doyle' },
        summary: {
          zh: '《血字的研究》诞生，夏洛克·福尔摩斯与华生奠定世界侦探小说基本叙事模式。',
          en: 'A Study in Scarlet establishes the canonical detective duo.',
        },
        primaryEntityId: 'wd:Q35610',
        focusEntityIds: ['wd:Q35610'],
        year: 1887,
      },
      {
        id: 'step-christie',
        title: { zh: '谋杀女王：阿加莎·克里斯蒂', en: 'Queen of Crime: Agatha Christie' },
        summary: {
          zh: '赫尔克里·波洛与马普尔小姐，暴风雪山庄与《无人生还》孤岛模式集大成。',
          en: 'Poirot, Miss Marple, and And Then There Were None.',
        },
        primaryEntityId: 'wd:Q35064',
        focusEntityIds: ['wd:Q35064'],
        year: 1920,
      },
      {
        id: 'step-orient-express',
        title: {
          zh: '孤岛与列车：东方快车谋杀案',
          en: 'The Orient Express: Murder on the Orient Express',
        },
        summary: {
          zh: '封闭空间、全员嫌疑、雪夜审判——克里斯蒂将本格诡计与群像叙事推向极致的教科书。',
          en: 'A locked train, twelve suspects, and one of the most iconic reveals in crime fiction.',
        },
        primaryEntityId: 'wd:Q845889',
        focusEntityIds: ['wd:Q845889'],
        year: 1934,
      },
      {
        id: 'step-carr',
        title: {
          zh: '密室之王：约翰·狄克森·卡尔',
          en: 'Master of Locked Rooms: John Dickson Carr',
        },
        summary: {
          zh: '菲尔博士与《三口棺材》，将“不可能犯罪”与密室讲义推向物理与逻辑极致。',
          en: 'Dr. Fell and The Hollow Man define impossible crime mechanics.',
        },
        primaryEntityId: 'wd:Q365664',
        focusEntityIds: ['wd:Q365664'],
        year: 1935,
      },
    ],
  },
  {
    id: 'trail-japan-evolution',
    slug: 'japan-mystery-evolution',
    title: {
      zh: '日本推理小说百年演进史',
      en: 'Centenary Evolution of Japanese Mystery',
      ja: '日本推理小説の百年と新本格',
    },
    description: {
      zh: '从江户川乱步的怪异本格、松本清张的社会派现实巨浪，到岛田庄司引领的新本格狂潮。',
      en: 'From Edogawa Ranpo to Seicho Matsumoto, Soji Shimada and the Shin-Honkaku revival.',
      ja: '江戸川乱歩から松本清張の社会派、島田荘司らの新本格ムーブメントまで。',
    },
    steps: [
      {
        id: 'step-ranpo',
        title: { zh: '拓荒之祖：江户川乱步', en: 'Pioneer: Edogawa Ranpo' },
        summary: {
          zh: '《两分铜币》与《D坂杀人事件》，创立日本推理作家协会与乱步奖。',
          en: 'The Father of Japanese Mystery and founder of MWJ.',
        },
        primaryEntityId: 'wd:Q347412',
        focusEntityIds: ['wd:Q347412'],
        year: 1923,
      },
      {
        id: 'step-yokomizo',
        title: { zh: '民俗本格：横沟正史', en: 'Folklore Honkaku: Seishi Yokomizo' },
        summary: {
          zh: '金田一耕助系列，《本阵杀人事件》与《犬神家族》古典怪奇与严密本格结合。',
          en: 'Kosuke Kindaichi and The Honjin Murders.',
        },
        primaryEntityId: 'wd:Q1072588',
        focusEntityIds: ['wd:Q1072588'],
        year: 1946,
      },
      {
        id: 'step-seicho',
        title: { zh: '社会派浪潮：松本清张', en: 'Social School: Seicho Matsumoto' },
        summary: {
          zh: '《点与线》和《零的焦点》，破除虚妄密室，将推理扎根于社会现实与人性黑暗。',
          en: 'Points and Lines transforms the genre with social realism.',
        },
        primaryEntityId: 'wd:Q201580',
        focusEntityIds: ['wd:Q201580'],
        year: 1958,
      },
      {
        id: 'step-shimada',
        title: { zh: '新本格教父：岛田庄司', en: 'Shin-Honkaku Godfather: Soji Shimada' },
        summary: {
          zh: '《占星术杀人魔法》宏大谜团与诗意构想，吹响新本格派复兴号角。',
          en: 'The Tokyo Zodiac Murders sparks the Shin-Honkaku revolution.',
        },
        primaryEntityId: 'wd:Q835759',
        focusEntityIds: ['wd:Q835759'],
        year: 1981,
      },
      {
        id: 'step-ayatsuji',
        title: { zh: '馆系列开篇：绫辻行人', en: 'Mansion Series: Yukito Ayatsuji' },
        summary: {
          zh: '《十角馆事件》十角形馆的惊天逆转，新本格运动正式席卷东亚。',
          en: 'The Decagon House Murders heralds the golden era of modern puzzle plots.',
        },
        primaryEntityId: 'wd:Q3266537',
        focusEntityIds: ['wd:Q3266537'],
        year: 1987,
      },
      {
        id: 'step-keigo',
        title: { zh: '当代畅销宗师：东野圭吾', en: 'Contemporary Master: Keigo Higashino' },
        summary: {
          zh: '《放学后》到《白夜行》《嫌疑人X的献身》，本格谜题与深邃情感的完美共鸣。',
          en: 'The Devotion of Suspect X and Journey Under the Midnight Sun.',
        },
        primaryEntityId: 'wd:Q125970',
        focusEntityIds: ['wd:Q125970'],
        year: 1985,
      },
    ],
  },
  {
    id: 'trail-origin',
    slug: 'detective-origin',
    title: {
      zh: '侦探小说创世纪',
      en: 'Genesis of Detective Fiction',
      ja: '探偵小説の起源',
    },
    description: {
      zh: '从爱伦·坡的莫格街血案到柯南·道尔的贝克街221B，看侦探小说如何在半个世纪内完成文体奠基。',
      en: 'From Poe to Doyle: how detective fiction invented itself in half a century.',
      ja: 'ポーからドイルへ、探偵小説がいかにして生まれたか。',
    },
    steps: [
      {
        id: 'step-poe',
        title: { zh: '开山祖师：埃德加·爱伦·坡', en: 'Founding Father: Edgar Allan Poe' },
        summary: {
          zh: '《莫格街凶杀案》首次确立“密室杀人+业余侦探+逻辑推理”的文体基石。',
          en: 'The Murders in the Rue Morgue establishes the locked-room, amateur sleuth formula.',
        },
        primaryEntityId: 'wd:Q16867',
        focusEntityIds: ['wd:Q16867'],
        year: 1841,
      },
      {
        id: 'step-collins',
        title: { zh: '长篇先锋：威尔基·柯林斯', en: 'Novel Pioneer: Wilkie Collins' },
        summary: {
          zh: '《月亮宝石》以多重视角叙事与失窃宝石之谜，开创长篇侦探小说的先河。',
          en: 'The Moonstone pioneers the full-length detective novel.',
        },
        primaryEntityId: 'wd:Q210740',
        focusEntityIds: ['wd:Q210740'],
        year: 1868,
      },
      {
        id: 'step-holmes',
        title: { zh: '名探诞生：阿瑟·柯南·道尔', en: 'Iconic Sleuth: Arthur Conan Doyle' },
        summary: {
          zh: '《血字的研究》让福尔摩斯与华生登场，“演绎法”成为侦探小说的通用语言。',
          en: 'A Study in Scarlet introduces Holmes, Watson, and deduction.',
        },
        primaryEntityId: 'wd:Q35610',
        focusEntityIds: ['wd:Q35610', 'wd:Q223131'],
        year: 1887,
      },
    ],
  },
  {
    id: 'trail-hardboiled',
    slug: 'american-hardboiled',
    title: {
      zh: '美国硬汉派私家侦探',
      en: 'American Hardboiled P.I.',
      ja: 'ハードボイルドの系譜',
    },
    description: {
      zh: '告别贵族庄园的优雅解谜，走进洛杉矶街头的肮脏现实——硬汉侦探的冷硬世界。',
      en: 'From drawing-room puzzles to mean streets: the hardboiled revolution.',
      ja: '名探偵から私立探偵へ、ストリートのリアリズム。',
    },
    steps: [
      {
        id: 'step-chandler',
        title: { zh: '冷硬之魂：雷蒙·钱德勒', en: 'Soul of Noir: Raymond Chandler' },
        summary: {
          zh: '菲利普·马洛与《漫长的告别》，“冷硬诗学”将侦探小说带入文学殿堂。',
          en: 'Philip Marlowe and The Long Goodbye elevate the genre to literature.',
        },
        primaryEntityId: 'wd:Q180377',
        focusEntityIds: ['wd:Q180377'],
        year: 1939,
      },
      {
        id: 'step-macdonald',
        title: { zh: '心理深潜：罗斯·麦克唐纳', en: 'Depth of Mind: Ross Macdonald' },
        summary: {
          zh: '卢·阿彻系列将家庭创伤与心理暗流注入冷硬外壳，拓宽了类型边界。',
          en: 'Lew Archer brings family trauma into the hardboiled tradition.',
        },
        primaryEntityId: 'wd:Q318297',
        focusEntityIds: ['wd:Q318297'],
        year: 1949,
      },
      {
        id: 'step-block',
        title: { zh: '都市漫游者：劳伦斯·布洛克', en: 'Urban Wanderer: Lawrence Block' },
        summary: {
          zh: '马修·斯卡德在纽约街头戒酒探案，硬汉派在新世纪的城市回声。',
          en: 'Matthew Scudder: alcoholic ex-cop, New York, and urban noir.',
        },
        primaryEntityId: 'douban:a劳伦斯·布洛克 (Lawrence Block)',
        focusEntityIds: ['douban:a劳伦斯·布洛克 (Lawrence Block)'],
        year: 1976,
      },
    ],
  },
  {
    id: 'trail-social-school',
    slug: 'japan-social-school',
    title: {
      zh: '日本社会派推理谱系',
      en: 'Japanese Social School',
      ja: '社会派の系譜',
    },
    description: {
      zh: '松本清张将镜头对准社会病灶，社会派推理自此成为映照日本世相的文学之镜。',
      en: 'Seicho Matsumoto turns the genre into a mirror of society.',
      ja: '松本清張が切り開いた社会派の流れ。',
    },
    steps: [
      {
        id: 'step-points',
        title: { zh: '社会派宣言：松本清张与《点与线》', en: 'Declaration: Seicho Matsumoto' },
        summary: {
          zh: '《点与线》撕碎虚妄密室，以时刻表诡计直指战后官僚腐败与人性深渊。',
          en: 'Points and Lines: timetable tricks, bureaucracy, and human darkness.',
        },
        primaryEntityId: 'wd:Q201580',
        focusEntityIds: ['wd:Q201580', 'wd:Q3738975'],
        year: 1958,
      },
      {
        id: 'step-morimura',
        title: { zh: '证明的时代：森村诚一', en: 'Age of Proof: Seiichi Morimura' },
        summary: {
          zh: '《人性的证明》让“证明”成为社会派关键词，销量神话席卷昭和后期。',
          en: 'Proof of the Man defines the social-school blockbuster.',
        },
        primaryEntityId: 'wd:Q2318799',
        focusEntityIds: ['wd:Q2318799'],
        year: 1969,
      },
      {
        id: 'step-miyabe',
        title: { zh: '温柔之眼：宫部美幸', en: 'Gentle Gaze: Miyuki Miyabe' },
        summary: {
          zh: '从《火车》到《模仿犯》，以社会派之眼看尽平成时代的孤独与焦虑。',
          en: 'The Shadow Family and the anxieties of Heisei-era Japan.',
        },
        primaryEntityId: 'wd:Q290021',
        focusEntityIds: ['wd:Q290021'],
        year: 1992,
      },
      {
        id: 'step-higashino',
        title: { zh: '情感推理：东野圭吾与《白夜行》', en: 'Emotional Mystery: Keigo Higashino' },
        summary: {
          zh: '《白夜行》让社会派命题在本格骨架里长出爱情与救赎的暗面。',
          en: 'Journey Under the Midnight Sun: love and sin beneath the puzzle.',
        },
        primaryEntityId: 'wd:Q125970',
        focusEntityIds: ['wd:Q125970', 'wd:Q710681'],
        year: 1998,
      },
    ],
  },
  {
    id: 'trail-neo-honkaku',
    slug: 'neo-honkaku-wave',
    title: {
      zh: '新本格浪潮',
      en: 'The Shin-Honkaku Wave',
      ja: '新本格ムーブメント',
    },
    description: {
      zh: '岛田庄司的宏大谜团唤醒沉睡的本格，绫辻行人的“馆系列”让新本格席卷东亚。',
      en: 'From Soji Shimada to the Mansion Series: the revival of classical puzzles.',
      ja: '島田荘司から始まる本格ミステリの復権。',
    },
    steps: [
      {
        id: 'step-zodiac',
        title: { zh: '革命前夜：岛田庄司与占星术', en: 'Eve of Revolution: Soji Shimada' },
        summary: {
          zh: '《占星术杀人事件》以不可能的宏大构想，宣告本格推理的浪漫复兴。',
          en: 'The Tokyo Zodiac Murders reignites the romance of impossible crimes.',
        },
        primaryEntityId: 'wd:Q835759',
        focusEntityIds: ['wd:Q835759', 'wd:Q10909686'],
        year: 1981,
      },
      {
        id: 'step-decagon',
        title: { zh: '馆系列开幕：绫辻行人', en: 'Mansion Series: Yukito Ayatsuji' },
        summary: {
          zh: '《杀人十角馆》十重逆转推翻一切定式，新本格运动正式启程。',
          en: 'The Decagon House Murders launches the Shin-Honkaku movement.',
        },
        primaryEntityId: 'wd:Q3266537',
        focusEntityIds: ['wd:Q3266537', 'wd:Q11255509'],
        year: 1987,
      },
      {
        id: 'step-kyogoku',
        title: { zh: '妖怪推理：京极夏彦', en: 'Yokai Mysteries: Natsuhiko Kyogoku' },
        summary: {
          zh: '《姑获鸟之夏》将民俗、妖怪学与密室完美融合，拓宽本格边界。',
          en: 'The Summer of the Ubume fuses folklore with locked rooms.',
        },
        primaryEntityId: 'wd:Q835766',
        focusEntityIds: ['wd:Q835766'],
        year: 1994,
      },
      {
        id: 'step-arisugawa',
        title: { zh: '双生视角：有栖川有栖', en: 'Twin Perspectives: Arisugawa Arisu' },
        summary: {
          zh: '火村英生系列以作家名作笔名致敬奎因，延续严密逻辑与古典气质。',
          en: 'The Professor series carries the Queen-style logic tradition forward.',
        },
        primaryEntityId: 'wd:Q5363645',
        focusEntityIds: ['wd:Q5363645'],
        year: 1996,
      },
    ],
  },
];

const insertChronicle = db.prepare(`
  INSERT OR REPLACE INTO chronicles (id, slug, title_json, description_json, steps_json)
  VALUES (?, ?, ?, ?, ?)
`);

db.transaction(() => {
  for (const t of trails) {
    insertChronicle.run(
      t.id,
      t.slug,
      JSON.stringify(t.title),
      JSON.stringify(t.description),
      JSON.stringify(t.steps),
    );
  }
})();

console.log('✅ Finished generating high-quality omm-d1.sqlite!');
