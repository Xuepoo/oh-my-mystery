import { describe, expect, test } from 'bun:test';
import { applyOverrides, cleanNames, isJunkLabel, isJunkNames } from './clean-labels';

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

describe('isJunkLabel', () => {
  test('rejects full-bracket-wrapped labels', () => {
    expect(isJunkLabel('[イーリアス]')).toBe(true);
    expect(isJunkLabel('[クィディッチ今昔] : [ホグワーツ校指定教科書 1]')).toBe(true);
    expect(isJunkLabel('[A Ghost Samba]')).toBe(true);
    expect(isJunkLabel('【推しの子】')).toBe(true);
    expect(isJunkLabel('[Mein*Star]')).toBe(true);
  });

  test('rejects nationality/format leading-bracket labels', () => {
    expect(isJunkLabel('[日]茂吕美耶')).toBe(true);
    expect(isJunkLabel('[加] 仇春卉')).toBe(true);
    expect(isJunkLabel('【英】阿瑟·柯南道尔')).toBe(true);
    expect(isJunkLabel('[ハングル]ハリー・ポッターと不死鳥の騎士団')).toBe(true);
  });

  test('rejects half-brackets', () => {
    expect(isJunkLabel('[J.スピリ')).toBe(true);
    expect(isJunkLabel('unclosed]')).toBe(true);
    expect(isJunkLabel('[原著］食道癌術後合併症の検討')).toBe(true);
  });

  test('rejects unknown-creator markers and date-only labels', () => {
    expect(isJunkLabel('[制作者不明]')).toBe(true);
    expect(isJunkLabel('制作者不明')).toBe(true);
    expect(isJunkLabel('作者不明')).toBe(true);
    expect(isJunkLabel('2024-6-18')).toBe(true);
    expect(isJunkLabel('2025-12')).toBe(true);
  });

  test('keeps legit labels with mid-string annotations or quotes', () => {
    expect(isJunkLabel('ハリー・ポッターと賢者の石【フランス語】')).toBe(false);
    expect(isJunkLabel('かの日の歌【一】')).toBe(false);
    expect(isJunkLabel('『クロック城』殺人事件')).toBe(false);
    expect(isJunkLabel('东野圭吾')).toBe(false);
    expect(isJunkLabel('')).toBe(false);
  });

  test('does not confuse unknown-marker substrings inside real titles', () => {
    expect(isJunkLabel('行方不明の処女作')).toBe(false);
  });
});

describe('cleanNames bracket hygiene', () => {
  test('drops bracket label but keeps clean sibling labels', () => {
    const r = cleanNames(
      JSON.stringify({ labels: { fr: '[Seul]', en: 'Alone', ja: 'Alone' }, aliases: {} }),
    );
    expect(r.labels.fr).toBeUndefined();
    expect(r.labels.en).toBe('Alone');
  });

  test('drops entities left with no clean label (NDL bracket works)', () => {
    const r = cleanNames(JSON.stringify({ labels: { ja: '[イーリアス]' }, aliases: {} }));
    expect(r.labels).toEqual({});
    expect(isJunkNames(r, 'work')).toBe(true);
  });

  test('drops single-label bracket authors with no fallback', () => {
    for (const label of ['[日]茂吕美耶', '[加] 仇春卉', '[制作者不明]', '2024-6-18']) {
      const r = cleanNames(JSON.stringify({ labels: { ja: label }, aliases: {} }));
      expect(isJunkNames(r, 'author')).toBe(true);
    }
  });

  test('drops half-bracket labels', () => {
    const r = cleanNames(JSON.stringify({ labels: { ja: '[J.スピリ' }, aliases: {} }));
    expect(isJunkNames(r, 'author')).toBe(true);
  });

  test('drops junk aliases but keeps clean ones', () => {
    const r = cleanNames(
      JSON.stringify({
        labels: { en: 'Oshi no Ko' },
        aliases: { en: ['[Oshi no Ko]', 'My Star'], ja: ['推しの子'] },
      }),
    );
    expect(r.labels.en).toBe('Oshi no Ko');
    expect(r.aliases.en).toEqual(['My Star']);
  });

  test('folds fullwidth brackets before judging', () => {
    expect(isJunkLabel('［法］米歇尔•普西')).toBe(true);
    const r = cleanNames(JSON.stringify({ labels: { zh: '［法］米歇尔•普西' }, aliases: {} }));
    expect(isJunkNames(r, 'author')).toBe(true);
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
