import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixtureDirectory, loadAndValidateFixture } from './fixture';

describe('VectoJS baseline API fixture', () => {
  test('is bounded, complete, and internally valid', async () => {
    const fixture = await loadAndValidateFixture();

    expect(fixture.manifest.schemaVersion).toBe(1);
    expect(fixture.manifest.routes.length).toBeGreaterThanOrEqual(18);
    expect(fixture.manifest.routes.length).toBeLessThanOrEqual(30);
    expect(fixture.responses.size).toBe(fixture.manifest.routes.length);
  });

  test('pins scenario IDs, copied value, controls, and required API families', async () => {
    const { manifest } = await loadAndValidateFixture();
    const paths = manifest.routes.map((route) => route.url);

    expect(manifest.entities).toEqual({
      rootAuthor: 'wd:Q347412',
      relatedWork: 'wd:Q1001',
      relatedAuthor: 'wd:Q35064',
      hiddenWork: 'wd:Q1002',
      globalOnlyResult: 'wd:Q9999',
    });
    expect(manifest.expected.firstProfileCopy).toBe('江户川乱步');
    expect(manifest.controls).toContain('casefile.tab.recommendations');
    expect(paths.some((path) => path === '/api/seeds')).toBe(true);
    expect(paths.some((path) => path.startsWith('/api/nodes?'))).toBe(true);
    expect(paths.some((path) => path.startsWith('/api/search?'))).toBe(true);
    expect(paths.some((path) => path.includes('/profile'))).toBe(true);
    expect(
      manifest.routes.filter((route) => route.status === 200 && route.url.includes('/relations?')),
    ).toHaveLength(3);
    expect(paths.some((path) => path.includes('/recommendations'))).toBe(true);
    expect(paths.some((path) => path.includes('/neighbors?'))).toBe(true);
    expect(paths.some((path) => path.startsWith('/api/path?'))).toBe(true);
    expect(paths.some((path) => path === '/api/chronicles')).toBe(true);
    expect(paths.some((path) => path === '/api/stats')).toBe(true);
    expect(manifest.routes.some((route) => route.status >= 400)).toBe(true);
  });

  test('stores valid JSON response bytes with one final newline', async () => {
    const { manifest } = await loadAndValidateFixture();

    for (const route of manifest.routes) {
      const bytes = await readFile(join(fixtureDirectory, route.response), 'utf8');
      expect(bytes.endsWith('\n')).toBe(true);
      expect(bytes.endsWith('\n\n')).toBe(false);
      expect(() => JSON.parse(bytes)).not.toThrow();
    }
  });
});
