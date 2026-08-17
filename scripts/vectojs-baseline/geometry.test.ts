import { expect, test } from 'bun:test';
import {
  classifyEscapeFinding,
  classifyOverlapFinding,
  classifyTargetFinding,
  escapeDepths,
  intersection,
  overlapFinding,
} from './geometry';

test('intersects half-open rectangles and ignores touching edges', () => {
  expect(
    intersection({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 5, height: 5 }),
  ).toBeNull();
  expect(
    intersection({ x: 0, y: 0, width: 10, height: 10 }, { x: 8, y: 7, width: 5, height: 5 }),
  ).toEqual({
    x: 8,
    y: 7,
    width: 2,
    height: 3,
  });
});

test('reports overlaps only when both dimensions exceed half a logical pixel', () => {
  expect(
    overlapFinding('scenario', 'b', { x: 9.5, y: 0, width: 2, height: 2 }, 'a', {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    }),
  ).toBeNull();
  expect(
    overlapFinding('scenario', 'b', { x: 9.4, y: 8, width: 2, height: 3 }, 'a', {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    }),
  ).toMatchObject({
    key: 'scenario:a|b',
    controlIds: ['a', 'b'],
    intersection: { x: 9.4, y: 8, width: 0.6, height: 2 },
  });
});

test('computes viewport escape depth on each edge', () => {
  expect(
    escapeDepths(
      { x: -2, y: -1, width: 105, height: 104 },
      { x: 0, y: 0, width: 100, height: 100 },
    ),
  ).toEqual({
    left: 2,
    right: 3,
    top: 1,
    bottom: 3,
  });
});

test('classifies target findings using size, shrink, and reachability limits', () => {
  expect(classifyTargetFinding(undefined, { width: 43, height: 44, activatable: true })).toBe(
    'new',
  );
  expect(
    classifyTargetFinding(
      { width: 40, height: 40, activatable: true },
      { width: 40, height: 40, activatable: true },
    ),
  ).toBe('grandfathered');
  expect(
    classifyTargetFinding(
      { width: 44, height: 44, activatable: true },
      { width: 43.4, height: 44, activatable: true },
    ),
  ).toBe('worsened');
  expect(
    classifyTargetFinding(
      { width: 44, height: 44, activatable: true },
      { width: 44, height: 44, activatable: false },
    ),
  ).toBe('failed');
});

test('classifies exact-key overlap and escape findings with edge tolerances', () => {
  const overlap = { left: 2, right: 2, top: 2, bottom: 2 };
  expect(classifyOverlapFinding(undefined, overlap)).toBe('new');
  expect(classifyOverlapFinding(overlap, overlap)).toBe('grandfathered');
  expect(classifyOverlapFinding(overlap, { ...overlap, right: 3.1 })).toBe('worsened');
  expect(classifyOverlapFinding(overlap, undefined)).toBe('improved');

  const escapedEdges = { left: 0, right: 1, top: 0, bottom: 0 };
  expect(classifyEscapeFinding(escapedEdges, { ...escapedEdges, right: 1.5 })).toBe(
    'grandfathered',
  );
  expect(classifyEscapeFinding(escapedEdges, { ...escapedEdges, right: 1.6 })).toBe('worsened');
  expect(classifyEscapeFinding(undefined, escapedEdges)).toBe('new');
});
