import { describe, expect, it } from 'bun:test';
import type { D1DataSource } from '../api/D1DataSource';
import { KnowledgeGraph2D } from './KnowledgeGraph2D';
import type { GraphNeighborhood2D, GraphNode2D } from './types';

function node(id: string): GraphNode2D {
  return { id, type: 'work', name: id, color: '#fff', val: 1, labels: { zh: id } };
}

describe('KnowledgeGraph2D paginated expansion', () => {
  it('accumulates pages, deduplicates facts, then collapses after exhaustion', async () => {
    const root = node('root');
    const shared = node('shared');
    const last = node('last');
    const pages: GraphNeighborhood2D[] = [
      {
        entity: root,
        neighbors: [shared],
        facts: [{ source: 'root', target: 'shared', predicate: 'publisher' }],
        nextCursor: '0:1',
        hasMore: true,
      },
      {
        entity: root,
        neighbors: [shared, last],
        facts: [
          { source: 'root', target: 'shared', predicate: 'publisher' },
          { source: 'root', target: 'last', predicate: 'publisher' },
        ],
        hasMore: false,
      },
    ];
    const requestedCursors: (string | undefined)[] = [];
    const source = {
      async getNeighbors(_id: string, options: { cursor?: string }) {
        requestedCursors.push(options.cursor);
        return pages.shift()!;
      },
    } as D1DataSource;
    const graph = new KnowledgeGraph2D({ source });
    await graph.bootstrap([root]);

    expect(await graph.toggleExpansion('root')).toBe(1);
    expect(graph.canLoadMore('root')).toBe(true);
    expect(await graph.toggleExpansion('root')).toBe(1);
    expect(requestedCursors).toEqual([undefined, '0:1']);
    expect(graph.nodes.map(({ id }) => id).sort()).toEqual(['last', 'root', 'shared']);
    expect(graph.links).toHaveLength(2);
    expect(graph.canLoadMore('root')).toBe(false);

    expect(await graph.toggleExpansion('root')).toBe(0);
    expect(graph.isExpanded('root')).toBe(false);
    expect(graph.nodes.map(({ id }) => id)).toEqual(['root']);
    expect(graph.links).toHaveLength(0);
    graph.dispose();
  });

  it('restarts an exhausted expansion when predicates change', async () => {
    const root = node('root');
    const calls: (readonly string[] | undefined)[] = [];
    const source = {
      async getNeighbors(_id: string, options: { predicates?: readonly string[] }) {
        calls.push(options.predicates);
        return { entity: root, neighbors: [], facts: [], hasMore: false };
      },
    } as D1DataSource;
    const graph = new KnowledgeGraph2D({ source });
    await graph.bootstrap([root]);

    await graph.toggleExpansion('root', ['author']);
    await graph.toggleExpansion('root', ['publisher']);
    expect(calls).toEqual([['author'], ['publisher']]);
    expect(graph.isExpanded('root')).toBe(true);
    graph.dispose();
  });

  it('preserves pagination ownership across snapshot restore', async () => {
    const root = node('root');
    const child = node('child');
    const source = {
      async getNeighbors() {
        return {
          entity: root,
          neighbors: [child],
          facts: [{ source: 'root', target: 'child', predicate: 'publisher' }],
          nextCursor: '0:7',
          hasMore: true,
        };
      },
    } as D1DataSource;
    const graph = new KnowledgeGraph2D({ source });
    await graph.bootstrap([root]);
    await graph.toggleExpansion('root', ['publisher']);

    const restored = new KnowledgeGraph2D({ source });
    restored.importSnapshot(graph.exportSnapshot());
    expect(restored.canLoadMore('root')).toBe(true);
    restored.collapse('root');
    expect(restored.nodes.map(({ id }) => id)).toEqual(['root']);
    expect(restored.links).toHaveLength(0);
    graph.dispose();
    restored.dispose();
  });

  it('ignores stale concurrent responses and preserves cursors after failures', async () => {
    const root = node('root');
    let resolveFirst!: (page: GraphNeighborhood2D) => void;
    const first = new Promise<GraphNeighborhood2D>((resolve) => {
      resolveFirst = resolve;
    });
    let call = 0;
    const source = {
      async getNeighbors() {
        call++;
        if (call === 1) return first;
        if (call === 2) {
          return {
            entity: root,
            neighbors: [node('new')],
            facts: [{ source: 'root', target: 'new', predicate: 'publisher' }],
            nextCursor: '0:2',
            hasMore: true,
          };
        }
        return { entity: root, neighbors: [], facts: [], hasMore: false, failed: true };
      },
    } as D1DataSource;
    const graph = new KnowledgeGraph2D({ source });
    await graph.bootstrap([root]);
    const stale = graph.toggleExpansion('root', ['author']);
    await graph.toggleExpansion('root', ['publisher']);
    resolveFirst({
      entity: root,
      neighbors: [node('stale')],
      facts: [{ source: 'root', target: 'stale', predicate: 'author' }],
      hasMore: false,
    });
    await stale;
    expect(graph.nodes.some(({ id }) => id === 'stale')).toBe(false);
    expect(graph.canLoadMore('root')).toBe(true);

    await graph.toggleExpansion('root', ['publisher']);
    expect(graph.canLoadMore('root')).toBe(true);
    graph.dispose();
  });

  it('keeps the existing expansion when a replacement filter request fails', async () => {
    const root = node('root');
    const child = node('child');
    let call = 0;
    const source = {
      async getNeighbors() {
        call++;
        if (call === 1) {
          return {
            entity: root,
            neighbors: [child],
            facts: [{ source: 'root', target: 'child', predicate: 'author' }],
            hasMore: false,
          };
        }
        return { entity: root, neighbors: [], facts: [], hasMore: false, failed: true };
      },
    } as D1DataSource;
    const graph = new KnowledgeGraph2D({ source });
    await graph.bootstrap([root]);
    await graph.toggleExpansion('root', ['author']);
    await graph.toggleExpansion('root', ['publisher']);
    expect(graph.isExpanded('root')).toBe(true);
    expect(graph.nodes.map(({ id }) => id).sort()).toEqual(['child', 'root']);
    expect(graph.links).toHaveLength(1);
    graph.dispose();
  });

  it('deduplicates semantically equivalent neighbors across pages', async () => {
    const root = node('root');
    const first = { ...node('local:work'), name: 'Same Work' };
    const duplicate = { ...node('wd:Q1'), name: '（日）same work' };
    const pages: GraphNeighborhood2D[] = [
      {
        entity: root,
        neighbors: [first],
        facts: [{ source: 'root', target: first.id, predicate: 'publisher' }],
        nextCursor: '0:1',
        hasMore: true,
      },
      {
        entity: root,
        neighbors: [duplicate],
        facts: [{ source: 'root', target: duplicate.id, predicate: 'publisher' }],
        hasMore: false,
      },
    ];
    const source = {
      async getNeighbors() {
        return pages.shift()!;
      },
    } as D1DataSource;
    const graph = new KnowledgeGraph2D({ source });
    await graph.bootstrap([root]);
    await graph.toggleExpansion('root');
    await graph.toggleExpansion('root');
    expect(graph.nodes.map(({ id }) => id).sort()).toEqual(['local:work', 'root']);
    expect(graph.links).toHaveLength(1);
    graph.dispose();
  });
});
