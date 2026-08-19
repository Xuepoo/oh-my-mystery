import { describe, expect, test } from 'bun:test';
import {
  buildPublisherLinks,
  buildPublisherNameIndex,
  isPublisherLiteral,
  maySynthesizePublisher,
  matchPublisherName,
  normalizePublisherName,
} from './publisher-normalization';

describe('normalizePublisherName', () => {
  test.each([
    ['尖端', '尖端出版'],
    ['尖端社', '尖端出版'],
    ['尖端出版社', '尖端出版'],
    ['英屬蓋曼群島商家庭傳媒股份有限公司城邦分公司尖端出版 (發行)', '尖端出版'],
    ['獨步文化出版', '獨步文化'],
    ['独步文化', '獨步文化'],
    ['臺灣角川', '台灣角川'],
    ['台湾角川', '台灣角川'],
    ['新雨出版社', '新雨'],
    ['春天出版國際文化', '春天出版國際'],
    ['春天出版国际', '春天出版國際'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizePublisherName(input)).toBe(expected);
  });
});

test('matches only exact normalized publisher aliases', () => {
  const index = new Map([
    ['台灣角川', 'douban:p台灣角川'],
    ['春天出版國際', 'douban:p春天出版國際'],
  ]);
  expect(matchPublisherName('台湾角川', index)).toBe('douban:p台灣角川');
  expect(matchPublisherName('春天出版國際文化', index)).toBe('douban:p春天出版國際');
  expect(matchPublisherName('不相关的春天出版国际扩展名称', index)).toBeNull();
});

test('selects the exact stable publisher entity and links aliases to it', () => {
  const candidates = [
    { id: 'douban:p尖端', source: 'douban', labels: ['尖端'] },
    { id: 'douban:p尖端出版', source: 'douban', labels: ['尖端出版'] },
    { id: 'douban:p尖端出版社', source: 'douban', labels: ['尖端出版社'] },
  ];
  const links = buildPublisherLinks(candidates);

  expect(links).toEqual(
    new Map([
      ['douban:p尖端', 'douban:p尖端出版'],
      ['douban:p尖端出版社', 'douban:p尖端出版'],
    ]),
  );
  expect(buildPublisherNameIndex(candidates, links)).toEqual(
    new Map([['尖端出版', 'douban:p尖端出版']]),
  );
});

test('indexes source aliases under the canonical cross-source publisher', () => {
  const candidates = [
    { id: 'wd:Q1', source: 'wikidata', labels: ['Sharp Point Press'] },
    { id: 'douban:p尖端出版', source: 'douban', labels: ['Sharp Point Press', '尖端社'] },
  ];
  const links = buildPublisherLinks(candidates);

  expect(links.get('douban:p尖端出版')).toBe('wd:Q1');
  expect(buildPublisherNameIndex(candidates, links).get('尖端出版')).toBe('wd:Q1');
});

test('rejects author responsibility values as publishers', () => {
  const authors = new Set(['白井智之']);
  expect(isPublisherLiteral('[白井智之]', authors)).toBe(false);
  expect(isPublisherLiteral('白井智之', authors)).toBe(false);
  expect(isPublisherLiteral('白井智之／阿津川辰海', authors)).toBe(false);
  expect(isPublisherLiteral('[白井智之', authors)).toBe(false);
  expect(isPublisherLiteral('白井智之]', authors)).toBe(false);
  expect(isPublisherLiteral('白井智之, 阿津川辰海', authors)).toBe(false);
  expect(isPublisherLiteral('尖端出版', authors)).toBe(true);
  expect(isPublisherLiteral('ハーパーコリンズ・ジャパン', authors)).toBe(true);
  expect(isPublisherLiteral('岩波文庫、岩波書店', authors)).toBe(true);
  expect(maySynthesizePublisher('ハーパーコリンズ・ジャパン')).toBe(true);
  expect(maySynthesizePublisher('岩波文庫、岩波書店')).toBe(false);
});
