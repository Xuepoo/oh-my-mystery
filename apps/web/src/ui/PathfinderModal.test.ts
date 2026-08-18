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
});
