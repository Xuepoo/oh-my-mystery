import { describe, expect, test } from 'bun:test';
import { aggregateFacts, addRecommendationSignal, buildWorkGroups } from './data-transforms';
import { formatWikidataDate } from '../packages/shared/src/types';
import {
  buildCountryLabelMap,
  countryLabelFromNames,
  normalizeCountryReference,
} from './country-labels';

describe('aggregateFacts', () => {
  test('collapses canonical assertions and preserves every source assertion', () => {
    const rows = aggregateFacts(
      [
        {
          subject_id: 'club:work',
          predicate: 'P166',
          object_ref: 'club:award',
          object_value: null,
          qualifiers_json: '{"year":2024,"status":"winner"}',
          source: 'club',
        },
        {
          subject_id: 'wd:Q1',
          predicate: 'award_received',
          object_ref: 'wd:Q2',
          object_value: null,
          qualifiers_json: '{"round":"第十届"}',
          source: 'wikidata',
        },
      ],
      (id) => ({ 'club:work': 'wd:Q1', 'club:award': 'wd:Q2' })[id] || id,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      subject_id: 'wd:Q1',
      predicate: 'award_received',
      object_ref: 'wd:Q2',
      source: 'club, wikidata',
    });
    expect(JSON.parse(rows[0]!.qualifiers_json!)).toEqual({
      assertions: [
        { source: 'club', status: 'winner', year: 2024 },
        { round: '第十届', source: 'wikidata' },
      ],
    });
  });

  test('removes exact duplicate assertions', () => {
    const fact = {
      subject_id: 'wd:Q1',
      predicate: 'award_received',
      object_ref: 'wd:Q2',
      object_value: null,
      qualifiers_json: '{"year":2024}',
      source: 'wikidata',
    };
    expect(JSON.parse(aggregateFacts([fact, fact], (id) => id)[0]!.qualifiers_json!)).toEqual({
      assertions: [{ source: 'wikidata', year: 2024 }],
    });
  });
});

describe('buildWorkGroups', () => {
  test('groups same-title editions with the same author but retains each member', () => {
    const groups = buildWorkGroups([
      { id: 'wd:Q1', names_json: '{"labels":{"zh":"嫌疑人X的献身"}}', author_ids: ['wd:A'] },
      { id: 'douban:1', names_json: '{"labels":{"zh":"《嫌疑人X的献身》"}}', author_ids: ['wd:A'] },
      { id: 'wd:Q3', names_json: '{"labels":{"zh":"嫌疑人X的献身"}}', author_ids: ['wd:B'] },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.memberIds.includes('wd:Q1'))?.memberIds).toEqual([
      'douban:1',
      'wd:Q1',
    ]);
  });
});

describe('recommendation signals', () => {
  test('aggregates reasons and keeps the strongest score per work group', () => {
    const scores = new Map();
    addRecommendationSignal(scores, 'work:group', 0.85, '相关推理奖项');
    addRecommendationSignal(scores, 'work:group', 0.95, '代表名作');
    addRecommendationSignal(scores, 'work:group', 0.7, '相关推理奖项');

    expect(scores.get('work:group')).toEqual({
      score: 0.95,
      reasons: ['代表名作', '相关推理奖项'],
    });
  });
});

describe('formatWikidataDate', () => {
  test('turns Wikidata timestamps into readable precision', () => {
    expect(formatWikidataDate('+1958-02-04T00:00:00Z')).toBe('1958-02-04');
    expect(formatWikidataDate('+1958-00-00T00:00:00Z')).toBe('1958');
    expect(formatWikidataDate('1985')).toBe('1985');
  });
});

describe('country labels', () => {
  test('prefers Chinese labels and supports legacy QID references', () => {
    expect(
      countryLabelFromNames(JSON.stringify({ labels: { en: 'Japan', ja: '日本', zh: '日本' } })),
    ).toBe('日本');
    expect(normalizeCountryReference('wd:Q17')).toBe('Q17');
    expect(normalizeCountryReference('Q17')).toBe('Q17');
  });

  test('ignores malformed country names', () => {
    expect(countryLabelFromNames('{broken')).toBeUndefined();
    expect(normalizeCountryReference('')).toBeUndefined();
  });

  test('resolves QID country labels regardless of entity type', () => {
    const map = buildCountryLabelMap([
      { qid: 'Q17', names_json: '{"labels":{"zh":"日本","ja":"日本","en":"Japan"}}' },
      { qid: 'Q30', names_json: '{"labels":{"en":"United States","zh":"美国"}}' },
      { qid: 'Q148', names_json: '{broken' },
    ]);
    expect(map.get('Q17')).toBe('日本');
    expect(map.get('Q30')).toBe('美国');
    expect(map.has('Q148')).toBe(false);
    expect(map.size).toBe(2);
  });
});
