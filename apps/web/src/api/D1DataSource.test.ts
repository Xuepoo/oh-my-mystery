import { afterEach, describe, expect, it, mock } from 'bun:test';
import { D1DataSource, DataSourceError } from './D1DataSource';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('D1DataSource casefile endpoints', () => {
  it('requests profile, relation pages, and recommendations independently', async () => {
    const requests: string[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      const body = url.endsWith('/profile')
        ? { entity: { id: 'wd:Q1', type: 'author', names: { labels: { zh: '作者' } } }, fields: [] }
        : url.includes('/relations')
          ? { entityId: 'wd:Q1', items: [], nextCursor: 'next' }
          : { entityId: 'wd:Q1', items: [] };
      return Response.json(body);
    }) as typeof fetch;

    const source = new D1DataSource('https://api.example');
    await source.fetchEntityProfile('wd:Q1');
    await source.fetchEntityRelations('wd:Q1', { limit: 12, cursor: 'cursor value' });
    await source.fetchEntityRecommendations('wd:Q1');

    expect(requests).toEqual([
      'https://api.example/api/entity/wd%3AQ1/profile',
      'https://api.example/api/entity/wd%3AQ1/relations?limit=12&cursor=cursor+value',
      'https://api.example/api/entity/wd%3AQ1/recommendations',
    ]);
  });

  it('throws typed HTTP and network errors', async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ error: 'Entity not found' }, { status: 404 }),
    ) as typeof fetch;
    const source = new D1DataSource();
    try {
      await source.fetchEntityProfile('missing');
      throw new Error('Expected request to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(DataSourceError);
      expect(error).toMatchObject({ kind: 'http', status: 404, message: 'Entity not found' });
    }

    globalThis.fetch = mock(async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    expect(source.fetchEntityRecommendations('wd:Q1')).rejects.toMatchObject({
      kind: 'network',
      status: undefined,
    });
  });
});
