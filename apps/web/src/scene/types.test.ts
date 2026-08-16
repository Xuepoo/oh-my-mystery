import { describe, expect, test } from 'bun:test';
import { pickNodeLabel } from './types';

describe('pickNodeLabel', () => {
  test('prefers a readable label over an ID-like Chinese label', () => {
    expect(pickNodeLabel({ zh: 'wd:Q130252326', en: 'The readable title' })).toBe(
      'The readable title',
    );
  });

  test('uses a readable alias when every label is an entity ID', () => {
    expect(pickNodeLabel({ zh: 'wd:Q130252326' }, 'zh', { en: ['The readable title'] })).toBe(
      'The readable title',
    );
  });
});
