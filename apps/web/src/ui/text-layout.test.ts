import { describe, expect, test } from 'bun:test';
import { splitGraphemes, truncateText, wrapText } from './text-layout';

const ctx = { measureText: (text: string) => ({ width: splitGraphemes(text).length * 10 }) };

describe('canvas text layout', () => {
  test('truncates within the measured width', () => {
    expect(truncateText(ctx, '推理知识图谱', 50)).toBe('推理知识…');
    expect(ctx.measureText(truncateText(ctx, '推理知识图谱', 50)).width).toBeLessThanOrEqual(50);
  });

  test('returns empty when even ellipsis cannot fit', () => {
    expect(truncateText(ctx, 'abc', 5)).toBe('');
  });

  test('does not split emoji grapheme clusters', () => {
    expect(splitGraphemes('A👩‍💻B')).toEqual(['A', '👩‍💻', 'B']);
    expect(truncateText(ctx, 'A👩‍💻BC', 30)).toBe('A👩‍💻…');
  });

  test('wraps CJK text and respects explicit newlines', () => {
    expect(wrapText(ctx, '推理知识\n图谱', 20)).toEqual(['推理', '知识', '图谱']);
  });

  test('limits lines with a bounded final line', () => {
    const lines = wrapText(ctx, '推理小说知识图谱', 30, 2);
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => ctx.measureText(line).width <= 30)).toBe(true);
  });
});
