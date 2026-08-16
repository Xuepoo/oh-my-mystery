import { beforeEach, describe, expect, test } from 'bun:test';
import { Theme } from './ui/theme';
import {
  NODE_STYLE_SETTINGS_STORAGE_KEY,
  NodeStyleRegistry,
  createDefaultNodeStyleSettings,
  loadNodeStyleSettings,
  normalizeNodeType,
  resetNodeStyleSettings,
  saveNodeStyleSettings,
} from './node-style-settings';

const storedValues = new Map<string, string>();
const storage: Storage = {
  get length() {
    return storedValues.size;
  },
  clear: () => storedValues.clear(),
  getItem: (key) => storedValues.get(key) ?? null,
  key: (index) => [...storedValues.keys()][index] ?? null,
  removeItem: (key) => storedValues.delete(key),
  setItem: (key, value) => storedValues.set(key, value),
};
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });

describe('node style settings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('normalizes canonical, person, genre, and unknown types', () => {
    expect(normalizeNodeType('author')).toBe('author');
    expect(normalizeNodeType('person')).toBe('author');
    expect(normalizeNodeType('genre')).toBe('genre');
    expect(normalizeNodeType(null)).toBe('other');
    expect(normalizeNodeType('not-a-node')).toBe('other');
  });

  test('uses Theme colors and balanced defaults', () => {
    const defaults = createDefaultNodeStyleSettings();
    expect(defaults.colors.author).toBe(Theme.colors.author);
    expect(defaults.colors.genre).toBe(Theme.colors.genre);
    expect(defaults.colors.other).toBe(Theme.colors.other);
    expect(defaults.sizeMultipliers.author).toBe(1);
    expect(defaults.distribution).toBe('balanced');
  });

  test('falls back for missing, corrupt, and unsupported versions', () => {
    expect(loadNodeStyleSettings()).toEqual(createDefaultNodeStyleSettings());
    localStorage.setItem(NODE_STYLE_SETTINGS_STORAGE_KEY, '{bad json');
    expect(loadNodeStyleSettings()).toEqual(createDefaultNodeStyleSettings());
    localStorage.setItem(NODE_STYLE_SETTINGS_STORAGE_KEY, JSON.stringify({ version: 99 }));
    expect(loadNodeStyleSettings()).toEqual(createDefaultNodeStyleSettings());
  });

  test('validates values and clamps size multipliers', () => {
    localStorage.setItem(
      NODE_STYLE_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        colors: { genre: '#123456', author: '' },
        sizeMultipliers: { author: 9, work: -2, genre: 'large', other: Number.NaN },
        distribution: 'invalid',
      }),
    );
    const settings = loadNodeStyleSettings();
    expect(settings.colors.genre).toBe('#123456');
    expect(settings.colors.author).toBe(Theme.colors.author);
    expect(settings.sizeMultipliers.author).toBe(2);
    expect(settings.sizeMultipliers.work).toBe(0.5);
    expect(settings.sizeMultipliers.genre).toBe(1);
    expect(settings.distribution).toBe('balanced');
  });

  test('round-trips saved settings through the versioned registry', () => {
    const settings = createDefaultNodeStyleSettings();
    settings.colors.genre = '#123456';
    settings.sizeMultipliers.author = 1.5;
    settings.distribution = 'dispersed';
    saveNodeStyleSettings(settings);

    const registry = new NodeStyleRegistry(loadNodeStyleSettings());
    expect(registry.getColor('genre')).toBe('#123456');
    expect(registry.getColor('person')).toBe(Theme.colors.author);
    expect(registry.getSizeMultiplier('author')).toBe(1.5);
  });

  test('reset removes persisted settings and restores defaults', () => {
    const settings = createDefaultNodeStyleSettings();
    settings.colors.genre = '#123456';
    saveNodeStyleSettings(settings);
    expect(resetNodeStyleSettings()).toEqual(createDefaultNodeStyleSettings());
    expect(localStorage.getItem(NODE_STYLE_SETTINGS_STORAGE_KEY)).toBeNull();
    expect(loadNodeStyleSettings()).toEqual(createDefaultNodeStyleSettings());
  });
});
