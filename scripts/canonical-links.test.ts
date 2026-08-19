import { expect, test } from 'bun:test';
import { buildQidLinks, buildUniqueWikidataLabelLinks } from './canonical-links';

test('links source entities to an existing Wikidata entity from qid backfill', () => {
  expect(
    buildQidLinks([
      { id: 'wd:Q18817673', qid: 'Q18817673' },
      { id: 'douban:a白井智之', qid: 'Q18817673' },
      { id: 'tuiliz:a9c8c25bfa6eb', qid: 'Q18817673' },
    ]),
  ).toEqual(
    new Map([
      ['douban:a白井智之', 'wd:Q18817673'],
      ['tuiliz:a9c8c25bfa6eb', 'wd:Q18817673'],
    ]),
  );
});

test('ignores malformed and unresolved qids', () => {
  expect(
    buildQidLinks([
      { id: 'source:missing', qid: 'Q404' },
      { id: 'source:bad', qid: 'not-a-qid' },
    ]),
  ).toEqual(new Map());
});

test('links a source author only when its label identifies one Wikidata author', () => {
  expect(
    buildUniqueWikidataLabelLinks([
      { id: 'wd:Q18817673', source: 'wikidata', labels: ['白井智之', 'Tomoyuki Shirai'] },
      { id: 'club:a9c8c25bfa6eb', source: 'club', labels: ['白井智之'] },
    ]),
  ).toEqual(new Map([['club:a9c8c25bfa6eb', 'wd:Q18817673']]));
});

test('does not link an ambiguous label', () => {
  expect(
    buildUniqueWikidataLabelLinks([
      { id: 'wd:Q1', source: 'wikidata', labels: ['同名'] },
      { id: 'wd:Q2', source: 'wikidata', labels: ['同名'] },
      { id: 'source:a', source: 'club', labels: ['同名'] },
    ]),
  ).toEqual(new Map());
});
