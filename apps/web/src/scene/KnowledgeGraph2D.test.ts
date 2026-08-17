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
    // Explicit "more" now chases remaining pages progressively.
    expect(await graph.toggleExpansion('root')).toBe(0);
    await graph.whenExpansionIdle('root');
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
    await graph.whenExpansionIdle('root');
    expect(graph.nodes.map(({ id }) => id).sort()).toEqual(['local:work', 'root']);
    expect(graph.links).toHaveLength(1);
    graph.dispose();
  });

  it('auto-chases small neighborhoods and stops after the first page for large ones', async () => {
    const root = node('root');
    const smallCalls: string[] = [];
    const smallSource = {
      async getNeighbors(_id: string, options: { cursor?: string }) {
        smallCalls.push(options.cursor ?? '');
        return {
          entity: root,
          neighbors: [node(`small-${smallCalls.length}`)],
          facts: [{ source: 'root', target: `small-${smallCalls.length}`, predicate: 'publisher' }],
          nextCursor: smallCalls.length < 2 ? `0:${smallCalls.length}` : undefined,
          hasMore: smallCalls.length < 2,
          total: 2,
        };
      },
    } as D1DataSource;
    const small = new KnowledgeGraph2D({ source: smallSource });
    await small.bootstrap([root]);
    await small.toggleExpansion('root');
    await small.whenExpansionIdle('root');
    expect(smallCalls).toEqual(['', '0:1']);
    expect(small.isNodeLoading('root')).toBe(false);
    expect(small.canLoadMore('root')).toBe(false);
    expect(small.nodes.map(({ id }) => id).sort()).toEqual(['root', 'small-1', 'small-2']);
    small.dispose();

    const largeCalls: string[] = [];
    const largeSource = {
      async getNeighbors(_id: string, options: { cursor?: string }) {
        largeCalls.push(options.cursor ?? '');
        return {
          entity: root,
          neighbors: [node('large-1')],
          facts: [{ source: 'root', target: 'large-1', predicate: 'publisher' }],
          nextCursor: '0:1',
          hasMore: true,
          total: 500,
        };
      },
    } as D1DataSource;
    const large = new KnowledgeGraph2D({ source: largeSource });
    await large.bootstrap([root]);
    await large.toggleExpansion('root');
    await large.whenExpansionIdle('root');
    expect(largeCalls).toEqual(['']);
    expect(large.canLoadMore('root')).toBe(true);
    expect(large.getExpansionProgress('root')).toEqual({ loaded: 1, total: 500 });
    large.dispose();
  });

  it('cancels an in-flight chase when the expansion collapses', async () => {
    const root = node('root');
    let calls = 0;
    let release: (() => void) | null = null;
    const source = {
      async getNeighbors(_id: string, options: { cursor?: string }) {
        calls++;
        if (options.cursor) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return {
          entity: root,
          neighbors: [node(`page-${calls}`)],
          facts: [{ source: 'root', target: `page-${calls}`, predicate: 'publisher' }],
          nextCursor: calls < 3 ? `0:${calls}` : undefined,
          hasMore: calls < 3,
          total: 100,
        };
      },
    } as D1DataSource;
    const graph = new KnowledgeGraph2D({ source });
    await graph.bootstrap([root]);
    await graph.toggleExpansion('root');
    await new Promise<void>((resolve) => {
      const check = () => (graph.isNodeLoading('root') ? resolve() : setTimeout(check, 0));
      check();
    });
    graph.collapse('root');
    release();
    release = null;
    await graph.whenExpansionIdle('root');
    expect(graph.isExpanded('root')).toBe(false);
    expect(graph.isNodeLoading('root')).toBe(false);
    expect(graph.nodes.map(({ id }) => id)).toEqual(['root']);
    graph.dispose();
  });

  it('hover pinning freezes the node and restores its previous pin state', async () => {
    const root = node('root');
    const source = {
      async getNeighbors() {
        return { entity: root, neighbors: [], facts: [], hasMore: false };
      },
    } as D1DataSource;
    const graph = new KnowledgeGraph2D({ source });
    await graph.bootstrap([root]);
    const beforeX = root.x ?? 0;
    const beforeY = root.y ?? 0;

    graph.setHoverPinned('root');
    expect(root.fx).toBe(beforeX);
    expect(root.fy).toBe(beforeY);

    graph.clearHoverPin();
    expect(root.fx).toBeNull();
    expect(root.fy).toBeNull();

    graph.togglePinned('root');
    graph.setHoverPinned('root');
    expect(root.fx).toBe(beforeX);
    graph.clearHoverPin();
    expect(root.fx).toBe(beforeX);
    graph.dispose();
  });

  it('preserves existing positions across incremental expansion and settles with finite coordinates', async () => {
    const root = node('root');
    const child = node('child');
    const source = {
      async getNeighbors() {
        return {
          entity: root,
          neighbors: [child],
          facts: [{ source: 'root', target: 'child', predicate: 'publisher' }],
          hasMore: false,
          total: 500,
        };
      },
    } as D1DataSource;
    const graph = new KnowledgeGraph2D({ source });
    await graph.bootstrap([root]);
    const initial = { x: root.x, y: root.y };

    await graph.toggleExpansion('root');
    expect({ x: root.x, y: root.y }).toEqual(initial);
    expect(Number.isFinite(child.x)).toBe(true);
    expect(Number.isFinite(child.y)).toBe(true);

    for (let tick = 0; tick < 1000 && graph.isSimulating(); tick++) graph.step();
    expect(graph.isSimulating()).toBe(false);
    for (const current of graph.nodes) {
      expect(Number.isFinite(current.x)).toBe(true);
      expect(Number.isFinite(current.y)).toBe(true);
    }
    graph.dispose();
  });

  it('keeps drag and permanent pins synchronized with the active layout', async () => {
    const root = node('root');
    const source = {
      async getNeighbors() {
        return { entity: root, neighbors: [], facts: [], hasMore: false };
      },
    } as D1DataSource;
    const graph = new KnowledgeGraph2D({ source });
    await graph.bootstrap([root]);

    expect(graph.beginNodeDrag('root')).toBe(true);
    expect(graph.updateNodeDrag('root', 120, -45)).toBe(true);
    for (let tick = 0; tick < 8; tick++) graph.step();
    expect({ x: root.x, y: root.y }).toEqual({ x: 120, y: -45 });

    graph.togglePinned('root');
    expect(graph.endNodeDrag('root')).toBe(true);
    graph.reheat(0.4);
    graph.step();
    expect({ x: root.x, y: root.y }).toEqual({ x: 120, y: -45 });

    expect(graph.togglePinned('root')).toBe(false);
    expect(graph.isSimulating()).toBe(true);
    graph.step();
    expect(Number.isFinite(root.x)).toBe(true);
    expect(Number.isFinite(root.y)).toBe(true);
    graph.dispose();
  });

  it('keeps relayout positions after the next physics tick', async () => {
    const root = node('root');
    const first = node('first');
    const second = node('second');
    const source = {
      async getNeighbors() {
        return {
          entity: root,
          neighbors: [first, second],
          facts: [
            { source: 'root', target: 'first', predicate: 'publisher' },
            { source: 'root', target: 'second', predicate: 'publisher' },
          ],
          hasMore: false,
        };
      },
    } as D1DataSource;
    const graph = new KnowledgeGraph2D({ source });
    await graph.bootstrap([root]);
    await graph.toggleExpansion('root');

    expect(graph.relayoutAround('root')).toBe(2);
    const before = graph.nodes.filter(({ id }) => id !== 'root').map(({ x, y }) => [x, y]);
    graph.step();
    const after = graph.nodes.filter(({ id }) => id !== 'root').map(({ x, y }) => [x, y]);
    for (let i = 0; i < before.length; i++) {
      expect(
        Math.hypot(
          (after[i]![0] ?? 0) - (before[i]![0] ?? 0),
          (after[i]![1] ?? 0) - (before[i]![1] ?? 0),
        ),
      ).toBeLessThan(20);
    }
    graph.dispose();
  });

  it('drops permanent pin state when collapse removes an owned node', async () => {
    const root = node('root');
    const child = node('child');
    const source = {
      async getNeighbors() {
        return {
          entity: root,
          neighbors: [child],
          facts: [{ source: 'root', target: 'child', predicate: 'publisher' }],
          hasMore: false,
        };
      },
    } as D1DataSource;
    const graph = new KnowledgeGraph2D({ source });
    await graph.bootstrap([root]);
    await graph.toggleExpansion('root');
    expect(graph.togglePinned('child')).toBe(true);

    graph.collapse('root');
    expect(graph.isPinned('child')).toBe(false);
    graph.dispose();
  });

  it('restores hidden expansion ownership across snapshots', async () => {
    const root = node('root');
    const child = node('child');
    const source = {
      async getNeighbors() {
        return {
          entity: root,
          neighbors: [child],
          facts: [{ source: 'root', target: 'child', predicate: 'publisher' }],
          hasMore: false,
        };
      },
    } as D1DataSource;
    const graph = new KnowledgeGraph2D({ source });
    await graph.bootstrap([root]);
    await graph.toggleExpansion('root');
    graph.hideNode('child');

    const restored = new KnowledgeGraph2D({ source });
    restored.importSnapshot(graph.exportSnapshot());
    expect(restored.restoreNode('child')).toBe(true);
    restored.collapse('root');
    expect(restored.getNode('child')).toBeUndefined();
    graph.dispose();
    restored.dispose();
  });

  it('drops permanent pin state when path replacement removes a transient node', async () => {
    const root = node('root');
    const transient = node('transient');
    const source = {
      async getNeighbors() {
        return { entity: root, neighbors: [], facts: [], hasMore: false };
      },
    } as D1DataSource;
    const graph = new KnowledgeGraph2D({ source });
    await graph.bootstrap([root]);
    graph.addPath(
      [root, transient],
      [{ source: 'root', target: 'transient', predicate: 'related' }],
    );
    expect(graph.togglePinned('transient')).toBe(true);

    graph.addPath([root], []);
    expect(graph.getNode('transient')).toBeUndefined();
    expect(graph.isPinned('transient')).toBe(false);
    graph.dispose();
  });

  it('separates hover, drag, and permanent pin ownership', async () => {
    const root = node('root');
    const child = node('child');
    const source = {
      async getNeighbors() {
        return {
          entity: root,
          neighbors: [child],
          facts: [{ source: 'root', target: 'child', predicate: 'publisher' }],
          hasMore: false,
        };
      },
    } as D1DataSource;
    const graph = new KnowledgeGraph2D({ source });
    await graph.bootstrap([root]);
    await graph.toggleExpansion('root');
    for (let tick = 0; tick < 1000 && graph.isSimulating(); tick++) graph.step();
    expect(graph.isSimulating()).toBe(false);

    const layout = graph['layout']!;
    const reheats: number[] = [];
    const originalReheat = layout.reheat.bind(layout);
    layout.reheat = (alpha?: number) => {
      reheats.push(alpha ?? 0.3);
      originalReheat(alpha);
    };

    graph.setHoverPinned('root');
    expect(graph.isSimulating()).toBe(false);
    expect(reheats).toEqual([]);

    expect(graph.beginNodeDrag('root')).toBe(true);
    expect(graph.isSimulating()).toBe(true);
    expect(graph.updateNodeDrag('root', 100, 100)).toBe(true);
    expect(graph.togglePinned('root')).toBe(true);
    reheats.length = 0;

    expect(graph.endNodeDrag('root')).toBe(true);
    expect(reheats).toEqual([0.08]);
    expect(graph.isPinned('root')).toBe(true);
    graph.clearHoverPin();
    graph.step();
    expect({ x: root.x, y: root.y }).toEqual({ x: 100, y: 100 });
    graph.dispose();
  });

  it('cancels a drag by restoring coordinates and permanent ownership', async () => {
    const root = node('root');
    const source = {
      async getNeighbors() {
        return { entity: root, neighbors: [], facts: [], hasMore: false };
      },
    } as D1DataSource;
    const graph = new KnowledgeGraph2D({ source });
    await graph.bootstrap([root]);
    graph.togglePinned('root');
    const original = { x: root.x ?? 0, y: root.y ?? 0 };

    expect(graph.beginNodeDrag('root')).toBe(true);
    expect(graph.updateNodeDrag('root', 90, -30)).toBe(true);
    expect(graph.cancelNodeDrag('root')).toBe(true);
    graph.step();

    expect(graph.isPinned('root')).toBe(true);
    expect({ x: root.x, y: root.y }).toEqual(original);
    graph.dispose();
  });

  it('clears transient pin ownership when a node is removed', async () => {
    const root = node('root');
    const transient = node('transient');
    const source = {
      async getNeighbors() {
        return { entity: root, neighbors: [], facts: [], hasMore: false };
      },
    } as D1DataSource;
    const graph = new KnowledgeGraph2D({ source });
    await graph.bootstrap([root]);
    graph.addPath(
      [root, transient],
      [{ source: 'root', target: 'transient', predicate: 'related' }],
    );
    graph.setHoverPinned('transient');
    expect(graph.beginNodeDrag('transient')).toBe(true);

    graph.addPath([root], []);

    expect(graph.getNode('transient')).toBeUndefined();
    expect(graph.endNodeDrag('transient')).toBe(false);
    graph.dispose();
  });

  it('clears transient ownership but preserves permanent pins on rebuild', async () => {
    const root = node('root');
    const source = {
      async getNeighbors() {
        return { entity: root, neighbors: [], facts: [], hasMore: false };
      },
    } as D1DataSource;
    const graph = new KnowledgeGraph2D({ source });
    await graph.bootstrap([root]);
    graph.togglePinned('root');
    graph.setHoverPinned('root');
    expect(graph.beginNodeDrag('root')).toBe(true);

    graph.addPath([root], []);

    expect(graph.isPinned('root')).toBe(true);
    expect(graph.endNodeDrag('root')).toBe(false);
    graph.dispose();
  });
});
