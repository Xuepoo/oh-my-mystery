import { describe, expect, it } from 'bun:test';
import type { PathfinderResult } from '@omm/shared';
import type { D1DataSource } from '../api/D1DataSource';
import { PathfinderModal } from './PathfinderModal';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createModal(findPath: D1DataSource['findPath']): PathfinderModal {
  const modal = new PathfinderModal({
    source: { findPath } as D1DataSource,
    onClose() {},
  });
  Object.defineProperty(modal, 'scene', { value: { markDirty() {} } });
  return modal;
}

describe('PathfinderModal request lifecycle', () => {
  it('resets loading on close and ignores the stale result after reopen', async () => {
    const request = deferred<PathfinderResult | null>();
    const modal = createModal(() => request.promise);
    modal.open();
    const search = modal.executeSearch();
    expect(modal['searchLoading']).toBe(true);

    modal.close();
    expect(modal['searchLoading']).toBe(false);
    modal.open();
    expect(modal['searchLoading']).toBe(false);

    request.resolve({ found: false, nodes: [], edges: [], hops: -1, explanation: 'stale' });
    await search;
    expect(modal['pathResult']).toBeNull();
    expect(modal['searchLoading']).toBe(false);
    modal.dispose();
  });

  it('invalidates an earlier request when open resets an already open modal', async () => {
    const request = deferred<PathfinderResult | null>();
    const modal = createModal(() => request.promise);
    modal.open();
    const search = modal.executeSearch();
    modal.open();
    expect(modal['searchLoading']).toBe(false);

    request.resolve({ found: false, nodes: [], edges: [], hops: -1, explanation: 'stale' });
    await search;
    expect(modal['pathResult']).toBeNull();
    modal.dispose();
  });

  it('auto-resolves typed names to the top search suggestion before searching', async () => {
    const searches: string[] = [];
    const pathCalls: [string, string][] = [];
    const modal = new PathfinderModal({
      source: {
        async search(query: string) {
          searches.push(query);
          return {
            query,
            results: [{ id: `${query}-id`, name: `${query}-name`, type: 'author', score: 1 }],
          };
        },
        async getNodes(ids: string[]) {
          return [{ id: ids[0]!, name: ids[0]!, type: 'author' }];
        },
        async findPath(source: string, target: string) {
          pathCalls.push([source, target]);
          return { found: false, nodes: [], edges: [], hops: -1, explanation: 'none' };
        },
      } as unknown as D1DataSource,
      onClose() {},
    });
    Object.defineProperty(modal, 'scene', { value: { markDirty() {} } });
    modal.open();

    const sourceState = modal['sourceState'] as {
      text: string;
      confirmed: unknown;
      suggestions: unknown[];
      selectedIndex: number;
      epoch: number;
    };
    const targetState = modal['targetState'] as {
      text: string;
      confirmed: unknown;
      suggestions: unknown[];
      selectedIndex: number;
      epoch: number;
    };
    sourceState.text = '江户川乱步';
    sourceState.confirmed = null;
    sourceState.suggestions = [];
    sourceState.selectedIndex = -1;
    targetState.text = '岛田庄司';
    targetState.confirmed = null;
    targetState.suggestions = [];
    targetState.selectedIndex = -1;

    await modal.executeSearch();

    expect(searches).toEqual(['江户川乱步', '岛田庄司']);
    expect(pathCalls).toEqual([['江户川乱步-id', '岛田庄司-id']]);
    modal.dispose();
  });

  it('shows a specific no-match message when a typed name cannot be resolved', async () => {
    const modal = new PathfinderModal({
      source: {
        async search() {
          return { query: '', results: [] };
        },
        async getNodes() {
          return [];
        },
        async findPath() {
          return { found: false, nodes: [], edges: [], hops: -1, explanation: 'none' };
        },
      } as unknown as D1DataSource,
      onClose() {},
    });
    Object.defineProperty(modal, 'scene', { value: { markDirty() {} } });
    modal.open();

    const sourceState = modal['sourceState'] as {
      text: string;
      confirmed: unknown;
      suggestions: unknown[];
      selectedIndex: number;
    };
    sourceState.text = '江户川乱布';
    sourceState.confirmed = null;
    sourceState.suggestions = [];
    sourceState.selectedIndex = -1;

    await modal.executeSearch();

    expect(modal['statusMessage']).toContain('江户川乱布');
    expect(modal['statusMessage']).toContain('未找到');
    modal.dispose();
  });
});
