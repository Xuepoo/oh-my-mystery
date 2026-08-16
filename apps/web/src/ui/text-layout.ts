export interface TextMeasureContext {
  measureText(text: string): { width: number };
}

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

export function splitGraphemes(text: string): string[] {
  if (segmenter) return [...segmenter.segment(text)].map((part) => part.segment);

  const result: string[] = [];
  for (const point of Array.from(text)) {
    const previous = result[result.length - 1];
    if (!previous || !isContinuation(point, previous)) result.push(point);
    else result[result.length - 1] = previous + point;
  }
  return result;
}

function isContinuation(point: string, previous: string): boolean {
  const codePoint = point.codePointAt(0) ?? 0;
  const isVariationSelector = codePoint === 0xfe0e || codePoint === 0xfe0f;
  const isSkinTone = codePoint >= 0x1f3fb && codePoint <= 0x1f3ff;
  const isJoiner = codePoint === 0x200d;
  return (
    /\p{Mark}/u.test(point) ||
    isVariationSelector ||
    isSkinTone ||
    isJoiner ||
    previous.endsWith('\u200D')
  );
}

export function truncateText(
  ctx: TextMeasureContext,
  text: string,
  maxWidth: number,
  ellipsis = '…',
): string {
  if (!text || maxWidth <= 0) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  if (ctx.measureText(ellipsis).width > maxWidth) return '';

  const graphemes = splitGraphemes(text);
  let low = 0;
  let high = graphemes.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = graphemes.slice(0, mid).join('') + ellipsis;
    if (ctx.measureText(candidate).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return graphemes.slice(0, low).join('') + ellipsis;
}

export function wrapText(
  ctx: TextMeasureContext,
  text: string,
  maxWidth: number,
  maxLines = Number.POSITIVE_INFINITY,
): string[] {
  if (!text || maxWidth <= 0 || maxLines <= 0) return [];
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const graphemes = splitGraphemes(paragraph);
    let current = '';
    for (const grapheme of graphemes) {
      const candidate = current + grapheme;
      if (current && ctx.measureText(candidate).width > maxWidth) {
        lines.push(current.trimEnd());
        current = grapheme.trimStart();
        if (lines.length === maxLines) {
          lines[maxLines - 1] = truncateText(ctx, lines[maxLines - 1]! + grapheme, maxWidth);
          return lines;
        }
      } else {
        current = candidate;
      }
    }
    if (current || paragraph === '') lines.push(current);
    if (lines.length >= maxLines) {
      lines.length = maxLines;
      const hasMore = paragraph !== text.split(/\r?\n/).at(-1) || graphemes.length > 0;
      if (hasMore)
        lines[maxLines - 1] = truncateText(ctx, lines[maxLines - 1]! + ellipsisSafe(), maxWidth);
      return lines;
    }
  }
  return lines;
}

function ellipsisSafe(): string {
  return '…';
}

export function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  preferred: number,
  minimum: number,
  fontFactory: (size: number) => string,
): number {
  let size = preferred;
  while (size > minimum) {
    ctx.font = fontFactory(size);
    if (ctx.measureText(text).width <= maxWidth) return size;
    size--;
  }
  ctx.font = fontFactory(minimum);
  return minimum;
}

export function withClip(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  draw: () => void,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, Math.max(0, rect.w), Math.max(0, rect.h));
  ctx.clip();
  try {
    draw();
  } finally {
    ctx.restore();
  }
}
