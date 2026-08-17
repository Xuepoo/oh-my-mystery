import { describe, expect, test } from 'bun:test';
import type {
  EntityProfileResponse,
  EntityRecommendationsResponse,
  EntityRelationsResponse,
} from '@omm/shared';
import {
  CasefileDrawer,
  CasefileSession,
  formatProfileText,
  movementCancelsActivation,
  type CasefileDataSource,
} from './CasefileDrawer';

const profile: EntityProfileResponse = {
  entity: {
    id: 'wd:Q1',
    type: 'author',
    names: { labels: { zh: '阿加莎·克里斯蒂' } },
  },
  fields: [
    { key: 'name', label: '名称', value: '阿加莎·克里斯蒂', copyValue: 'Agatha Christie' },
    { key: 'isbn', label: 'ISBN', value: '9787569930979', copyValue: '9787569930979' },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function source(overrides: Partial<CasefileDataSource> = {}): CasefileDataSource {
  return {
    fetchEntityProfile: async () => profile,
    fetchEntityRelations: async (): Promise<EntityRelationsResponse> => ({
      entityId: 'wd:Q1',
      items: [],
    }),
    fetchEntityRecommendations: async (): Promise<EntityRecommendationsResponse> => ({
      entityId: 'wd:Q1',
      items: [],
    }),
    ...overrides,
  };
}

describe('CasefileSession', () => {
  test('loads only profile on open and lazily caches each tab', async () => {
    const calls: string[] = [];
    const session = new CasefileSession(
      source({
        fetchEntityProfile: async () => {
          calls.push('profile');
          return profile;
        },
        fetchEntityRelations: async () => {
          calls.push('relations');
          return { entityId: 'wd:Q1', items: [] };
        },
        fetchEntityRecommendations: async () => {
          calls.push('recommendations');
          return { entityId: 'wd:Q1', items: [] };
        },
      }),
      () => {},
    );

    await session.open('wd:Q1');
    expect(calls).toEqual(['profile']);
    await session.activate('relations');
    await session.activate('profile');
    await session.activate('relations');
    await session.activate('recommendations');
    expect(calls).toEqual(['profile', 'relations', 'recommendations']);
  });

  test('ignores stale profile and lazy-tab responses across open epochs', async () => {
    const firstProfile = deferred<EntityProfileResponse>();
    const firstRelations = deferred<EntityRelationsResponse>();
    const session = new CasefileSession(
      source({
        fetchEntityProfile: (id) =>
          id === 'wd:Q1'
            ? firstProfile.promise
            : Promise.resolve({ ...profile, entity: { ...profile.entity, id } }),
        fetchEntityRelations: (id) =>
          id === 'wd:Q1' ? firstRelations.promise : Promise.resolve({ entityId: id, items: [] }),
      }),
      () => {},
    );

    void session.open('wd:Q1');
    void session.activate('relations');
    await session.open('wd:Q2');
    firstProfile.resolve(profile);
    firstRelations.resolve({ entityId: 'wd:Q1', items: [] });
    await Promise.resolve();
    expect(session.entityId).toBe('wd:Q2');
    expect(session.profile.status).toBe('ready');
    expect(session.relations.status).toBe('idle');
  });

  test('retries profile errors and resets all caches when reopened', async () => {
    let fail = true;
    const session = new CasefileSession(
      source({
        fetchEntityProfile: async () => {
          if (fail) throw new Error('offline');
          return profile;
        },
      }),
      () => {},
    );

    await session.open('wd:Q1');
    expect(session.profile.status).toBe('error');
    fail = false;
    await session.retryProfile();
    expect(session.profile.status).toBe('ready');
    session.setScroll('profile', 42);
    await session.activate('relations');
    await session.open('wd:Q1');
    expect(session.getScroll('profile')).toBe(0);
    expect(session.relations.status).toBe('idle');
  });

  test('appends relation pages by factId and preserves independent scroll', async () => {
    const session = new CasefileSession(
      source({
        fetchEntityRelations: async (_id, options) =>
          options?.cursor
            ? {
                entityId: 'wd:Q1',
                items: [
                  {
                    factId: 1,
                    predicate: 'author',
                    label: '作者',
                    value: 'duplicate',
                    copyValue: 'duplicate',
                    direction: 'outgoing',
                  },
                  {
                    factId: 2,
                    predicate: 'award',
                    label: '奖项',
                    value: 'new',
                    copyValue: 'new',
                    direction: 'outgoing',
                  },
                ],
              }
            : {
                entityId: 'wd:Q1',
                items: [
                  {
                    factId: 1,
                    predicate: 'author',
                    label: '作者',
                    value: 'first',
                    copyValue: 'first',
                    direction: 'outgoing',
                  },
                ],
                nextCursor: 'next',
              },
      }),
      () => {},
    );

    await session.open('wd:Q1');
    await session.activate('relations');
    await session.loadMoreRelations();
    expect(
      session.relations.status === 'ready' && session.relations.items.map((x) => x.factId),
    ).toEqual([1, 2]);
    session.setScroll('profile', 15);
    session.setScroll('relations', 80);
    expect(session.getScroll('profile')).toBe(15);
    expect(session.getScroll('relations')).toBe(80);
  });

  test('keeps rows after one page failure and reloads page one after repeated 400', async () => {
    let pageAttempts = 0;
    const session = new CasefileSession(
      source({
        fetchEntityRelations: async (_id, options) => {
          if (!options?.cursor) {
            return {
              entityId: 'wd:Q1',
              items: [
                {
                  factId: 1,
                  predicate: 'author',
                  label: '作者',
                  value: 'first',
                  copyValue: 'first',
                  direction: 'outgoing',
                },
              ],
              nextCursor: 'bad',
            };
          }
          pageAttempts++;
          throw Object.assign(new Error('bad cursor'), { status: 400 });
        },
      }),
      () => {},
    );

    await session.open('wd:Q1');
    await session.activate('relations');
    await session.loadMoreRelations();
    expect(session.relations.status === 'ready' && session.relations.items).toHaveLength(1);
    expect(session.relations.status === 'ready' && session.relations.pageStatus).toBe('error');
    await session.loadMoreRelations();
    expect(pageAttempts).toBe(2);
    expect(session.relations.status === 'ready' && session.relations.pageStatus).toBe('idle');
    expect(session.relations.status === 'ready' && session.relations.items).toHaveLength(1);
  });
});

describe('Casefile copy interactions', () => {
  test('top copy contains profile display lines while row copy uses copyValue', () => {
    expect(formatProfileText(profile)).toBe('名称：阿加莎·克里斯蒂\nISBN：9787569930979');
    expect(profile.fields[0]!.copyValue).toBe('Agatha Christie');
  });

  test('uses pointer-specific Euclidean movement thresholds', () => {
    expect(movementCancelsActivation('touch', 6, 8)).toBe(false);
    expect(movementCancelsActivation('touch', 6.1, 8)).toBe(true);
    expect(movementCancelsActivation('mouse', 3.6, 4.8)).toBe(false);
    expect(movementCancelsActivation('pen', 3.7, 4.8)).toBe(true);
  });

  test('keeps rendering active while profile data is loading', async () => {
    const loading = deferred<EntityProfileResponse>();
    const drawer = new CasefileDrawer({
      source: source({ fetchEntityProfile: () => loading.promise }),
      onClose: () => {},
      onSelectEntity: () => {},
    });
    drawer.open('wd:Q1');
    expect(drawer.hasPendingAnimations()).toBe(true);
    loading.resolve(profile);
    await Promise.resolve();
    await Promise.resolve();
    expect(drawer.hasPendingAnimations()).toBe(false);
  });
});
