import { expect, test } from 'bun:test';
import {
  compareBounded,
  compareFiveRuns,
  comparePercentage,
  compareZeroRequired,
  medianOfFive,
  nearestRank,
} from './metrics';

test('uses nearest-rank percentiles without interpolation', () => {
  const forty = Array.from({ length: 40 }, (_, index) => index + 1);
  const fifty = Array.from({ length: 50 }, (_, index) => index + 1);
  expect(nearestRank(forty, 0.5)).toBe(20);
  expect(nearestRank(forty, 0.95)).toBe(38);
  expect(nearestRank(fifty, 0.5)).toBe(25);
  expect(nearestRank(fifty, 0.95)).toBe(48);
  expect(() => nearestRank([1, Number.NaN], 0.5)).toThrow('finite');
});

test('takes the median of exactly five finite runs', () => {
  expect(medianOfFive([9, 1, 5, 7, 3])).toBe(5);
  expect(() => medianOfFive([1, 2, 3])).toThrow('exactly five');
});

test('compares percentage regressions only above measurement tolerance', () => {
  expect(comparePercentage(100, 110, 1, 10)).toEqual({
    mode: 'percentage',
    percentage: 10,
    passed: true,
  });
  expect(comparePercentage(0.5, 0.75, 1, 10)).toEqual({
    mode: 'bounded',
    percentage: null,
    passed: true,
  });
  expect(comparePercentage(0.5, 1.01, 1, 10).passed).toBe(false);
});

test('supports explicit bounded and zero-required comparisons', () => {
  expect(compareBounded(0.5, 0.5)).toEqual({ mode: 'bounded', passed: true });
  expect(compareBounded(0.51, 0.5).passed).toBe(false);
  expect(compareZeroRequired([0, 0, 0, 0, 0], [0, 0, 0, 0, 0])).toEqual({
    mode: 'zero-required',
    passed: true,
  });
  expect(compareZeroRequired([0, 0, 0, 0, 0], [0, 0, 1, 0, 0]).passed).toBe(false);
});

test('propagates every raw correctness failure before comparing medians', () => {
  const outcome = compareFiveRuns({
    baseline: [10, 10, 10, 10, 10],
    candidate: [10, 10, 10, 10, 100],
    tolerance: 0.1,
    regressionLimit: 10,
    isCorrect: (value) => value < 50,
  });

  expect(outcome.baselineMedian).toBe(10);
  expect(outcome.candidateMedian).toBe(10);
  expect(outcome.rawCorrectnessPassed).toBe(false);
  expect(outcome.passed).toBe(false);
  expect(outcome.correctnessFailures).toEqual([{ arm: 'candidate', repetition: 5, value: 100 }]);
});
