import { describe, expect, test } from 'bun:test';
import {
  collisionOverlapCount,
  displacementMetrics,
  nonFinitePositionCount,
  peakLinkLengthRatio,
  undirectedHopDistances,
  velocityDirectionChangeCount,
  type MetricLink,
  type Position,
} from './graph-metrics';

const links: MetricLink[] = [
  { source: 'a', target: 'b' },
  { source: 'b', target: 'c' },
  { source: 'c', target: 'd' },
];

test('counts non-finite positions', () => {
  expect(
    nonFinitePositionCount([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: Number.NaN, y: 1 },
      { id: 'c', x: 1, y: Number.POSITIVE_INFINITY },
    ]),
  ).toBe(2);
});

test('counts collision overlap only above one world unit', () => {
  expect(
    collisionOverlapCount(
      [
        { id: 'a', x: 0, y: 0, radius: 5 },
        { id: 'b', x: 8.9, y: 0, radius: 5 },
        { id: 'c', x: 20, y: 0, radius: 5 },
      ],
      1,
    ),
  ).toBe(1);
});

test('computes undirected hops and displacement populations', () => {
  const before: Position[] = ['a', 'b', 'c', 'd'].map((id, index) => ({ id, x: index, y: 0 }));
  const after: Position[] = before.map((position, index) => ({
    ...position,
    x: position.x + index + 1,
  }));
  const hops = undirectedHopDistances(links, 'a');

  expect([...hops.entries()]).toEqual([
    ['a', 0],
    ['b', 1],
    ['c', 2],
    ['d', 3],
  ]);
  expect(displacementMetrics(before, after, hops, 2)).toEqual({
    rms: Math.sqrt(7.5),
    farMaximum: 4,
  });
});

test('computes the peak configured link ratio', () => {
  const positions: Position[] = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 3, y: 4 },
    { id: 'c', x: 13, y: 4 },
  ];

  expect(
    peakLinkLengthRatio(positions, links.slice(0, 2), (link) => (link.source === 'a' ? 5 : 2)),
  ).toBe(5);
});

describe('late velocity direction changes', () => {
  test('uses the final 60 active deltas and excludes the dragged node', () => {
    const snapshots: Position[][] = [];
    for (let tick = 0; tick <= 65; tick += 1) {
      snapshots.push([
        { id: 'dragged', x: tick % 2, y: 0 },
        { id: 'stable', x: tick, y: 0 },
        { id: 'oscillating', x: tick % 2, y: 0 },
      ]);
    }

    expect(velocityDirectionChangeCount(snapshots, 'dragged')).toBe(59);
  });

  test('ignores zero signs and movement at or below the speed threshold', () => {
    expect(
      velocityDirectionChangeCount([
        [{ id: 'a', x: 0, y: 0 }],
        [{ id: 'a', x: 0.005, y: 0 }],
        [{ id: 'a', x: -0.005, y: 0 }],
        [{ id: 'a', x: -1, y: 0 }],
        [{ id: 'a', x: -1, y: 0 }],
      ]),
    ).toBe(0);
  });
});
