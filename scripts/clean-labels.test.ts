import { describe, expect, test } from 'bun:test';
import { applyOverrides, cleanNames, isJunkNames } from './clean-labels';

describe('cleanNames', () => {
  test('trims whitespace and trailing separators', () => {
    const r = cleanNames(
      JSON.stringify({ labels: { zh: ' 東野圭吾 ', en: 'Keigo Higashino，' }, aliases: {} }),
    );
    expect(r.labels.zh).toBe('东野圭吾');
    expect(r.labels.en).toBe('Keigo Higashino');
  });

  test('drops control characters and empty labels', () => {
    const r = cleanNames(
      JSON.stringify({ labels: { zh: '松本\u0007清张', en: '  ' }, aliases: { zh: [' ', ''] } }),
    );
    expect(r.labels.zh).toBe('松本清张');
    expect(r.labels.en).toBeUndefined();
    expect(r.aliases.zh).toBeUndefined();
  });

  test('unifies zh labels to simplified, leaves ja labels untouched', () => {
    const r = cleanNames(
      JSON.stringify({
        labels: { zh: '橫溝正史', ja: '横溝正史' },
        aliases: { zh: ['橫沟正史,'] },
      }),
    );
    expect(r.labels.zh).toBe('横沟正史');
    expect(r.labels.ja).toBe('横溝正史');
    expect(r.aliases.zh).toEqual(['横沟正史']);
  });

  test('does not script-convert kana-containing labels', () => {
    const r = cleanNames(JSON.stringify({ labels: { zh: '乾くるみ' }, aliases: {} }));
    expect(r.labels.zh).toBe('乾くるみ');
  });

  test('converts labels whose only kana-range char is the middle dot', () => {
    const r = cleanNames(JSON.stringify({ labels: { zh: '謝爾・艾瑞克森' }, aliases: {} }));
    expect(r.labels.zh).toBe('谢尔・艾瑞克森');
  });

  test('does not convert 乾 even without kana', () => {
    const r = cleanNames(JSON.stringify({ labels: { zh: '乾胡桃' }, aliases: {} }));
    expect(r.labels.zh).toBe('乾胡桃');
  });

  test('dedupes aliases and drops alias equal to label', () => {
    const r = cleanNames(
      JSON.stringify({
        labels: { zh: '横沟正史' },
        aliases: { zh: ['横沟正史', '横沟正史', 'ヨコセイ'] },
      }),
    );
    expect(r.aliases.zh).toEqual(['横沟正史', 'ヨコセイ']);
  });

  test('handles broken JSON gracefully', () => {
    expect(cleanNames('not json')).toEqual({ labels: {}, aliases: {} });
    expect(cleanNames(null)).toEqual({ labels: {}, aliases: {} });
  });
});

describe('applyOverrides', () => {
  test('applies curated override for known-bad labels', () => {
    const names = cleanNames(JSON.stringify({ labels: { zh: '横構正史' }, aliases: {} }));
    const r = applyOverrides('wd:Q1072588', names);
    expect(r.labels.zh).toBe('横沟正史');
  });

  test('ignores unknown entity ids', () => {
    const names = { labels: { zh: '阿加莎·克里斯蒂' }, aliases: {} };
    expect(applyOverrides('wd:Q9999', names)).toEqual(names);
  });

  test('adds curated zh names for awards missing a zh label', () => {
    const names = cleanNames(JSON.stringify({ labels: { en: 'Gold Dagger' }, aliases: {} }));
    const r = applyOverrides('cwa:category:e2fb13710b', names);
    expect(r.labels.zh).toBe('金匕首奖');
    expect(r.labels.en).toBe('Gold Dagger');
  });

  test('does not overwrite an existing zh label', () => {
    const names = { labels: { zh: '钻石匕首奖', en: 'Diamond Dagger' }, aliases: {} };
    const r = applyOverrides('cwa:category:2858481197', names);
    expect(r.labels.zh).toBe('钻石匕首奖');
  });
});

describe('isJunkNames', () => {
  test('flags empty label sets', () => {
    expect(isJunkNames({ labels: {}, aliases: {} })).toBe(true);
  });

  test('flags hex-only labels', () => {
    expect(isJunkNames({ labels: { en: '49996ee9be' }, aliases: {} })).toBe(true);
    expect(isJunkNames({ labels: { en: '49996ee9be' }, aliases: { en: ['03509f2d3e'] } })).toBe(
      true,
    );
  });

  test('accepts real names', () => {
    expect(isJunkNames({ labels: { en: 'Diamond Dagger' }, aliases: {} })).toBe(false);
    expect(isJunkNames({ labels: { en: '49996ee9be' }, aliases: { en: ['Diamond Dagger'] } })).toBe(
      false,
    );
  });

  test('flags author entities with joined multi-author labels', () => {
    const names = { labels: { zh: '阿加莎·克里斯蒂、[英] 阿加莎·克里斯蒂' }, aliases: {} };
    expect(isJunkNames(names, 'author')).toBe(true);
    expect(isJunkNames(names, 'work')).toBe(false);
  });
});
