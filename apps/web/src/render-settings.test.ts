import { describe, expect, test } from 'bun:test';
import { estimateDisplayRefresh } from './render-settings';

describe('display refresh estimation', () => {
  test('does not report 250 Hz for quantized 240 Hz frames', () => {
    expect(estimateDisplayRefresh([4, 4, 4, 4, 4, 4, 4, 4.2, 8])).toBe(240);
  });

  test('ignores occasional jank and preserves common refresh modes', () => {
    expect(estimateDisplayRefresh([6.9, 6.95, 6.94, 6.96, 6.93, 13.9, 30])).toBe(144);
    expect(estimateDisplayRefresh([16.6, 16.7, 16.65, 16.68, 16.66, 33])).toBe(60);
  });

  test('does not let minority short samples over-report the dominant cadence', () => {
    expect(estimateDisplayRefresh([16.7, 16.7, 16.7, 16.7, 16.7, 8, 8])).toBe(60);
  });

  test('recognizes common modes from quantized timestamp mixtures', () => {
    const cases: [number, number[]][] = [
      [60, [16, 16, 16, 20, 16, 16, 16, 16]],
      [90, [12, 12, 8, 12, 12, 12, 8, 12]],
      [120, [8, 8, 8, 8, 8, 8, 8, 8]],
      [144, [8, 8, 4, 8, 8, 4, 8, 8, 4]],
      [165, [8, 4, 8, 4, 8, 4, 8, 4]],
      [240, [4, 4, 4, 4, 4, 4, 4, 4]],
      [360, [4, 4, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5]],
    ];
    for (const [rate, intervals] of cases) {
      expect(estimateDisplayRefresh(intervals)).toBe(rate);
    }
  });

  test('falls back conservatively when there are too few valid samples', () => {
    expect(estimateDisplayRefresh([4, Number.NaN, 0])).toBe(60);
  });
});
