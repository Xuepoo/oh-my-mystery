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

    insertSearch.run(
      e.id,
      e.type,
      labels['zh'] || labels['zh-cn'] || labels['zh-tw'] || labels['zh-hk'] || null,
      labels['en'] || null,
      labels['ja'] || null,
      allAliases.join(' | ') || null,
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

db.transaction(() => {
  for (const f of factsRows) {
    // Canonicalize IDs if linked
    const sub = resolveLink(f.subject_id);
    const obj = f.object_ref ? resolveLink(f.object_ref) : f.object_ref;

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

      const inns = inEdges.get(obj) || [];
      inns.push({ predicate: f.predicate, source: sub });
      inEdges.set(obj, inns);
    }
  }
})();

console.log(`✓ Inserted ${validFacts.length} connected facts`);

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
      zh: '从阿瑟·柯南·道尔开辟神探传统，到阿加莎、卡尔与奎因确立密室、读者挑战书与严密逻辑解谜的巅峰时代。',
      en: 'From Arthur Conan Doyle to Agatha Christie, John Dickson Carr and Ellery Queen.',
      ja: 'コナン・ドイルからクリスティ、カー、クイーンへと続く古典本格の黄金期。',
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
      {
        id: 'step-queen',
        title: { zh: '逻辑演绎：埃勒里·奎因', en: 'Logical Deduction: Ellery Queen' },
        summary: {
          zh: '“向读者挑战书”与国名系列/悲剧系列，纯粹唯美逻辑推演的最高峰。',
          en: 'Challenge to the Reader and the Roman Hat Mystery.',
        },
        primaryEntityId: 'wd:Q723221',
        focusEntityIds: ['wd:Q723221'],
        year: 1929,
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
