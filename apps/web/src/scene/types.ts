export type NodeId = string;

export interface GraphNode2D {
  id: string;
  type: string;
  name: string;
  color: string;
  val: number;
  degree?: number;
  radius?: number;
  labels: Record<string, string>;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  sx?: number;
  sy?: number;
}

export interface GraphLink2D {
  source: string | GraphNode2D;
  target: string | GraphNode2D;
  predicate: string;
}

export interface GraphNeighborhood2D {
  entity: GraphNode2D;
  facts: GraphLink2D[];
  neighbors: GraphNode2D[];
  nextCursor?: string;
  hasMore: boolean;
  failed?: boolean;
}

export function pickNodeLabel(
  labels: Record<string, string> | undefined,
  lang = 'zh',
  aliases?: Record<string, string[]>,
): string {
  if (!labels && !aliases) return '';
  const candidates = [
    labels?.[lang],
    lang === 'zh' ? labels?.['zh-cn'] : undefined,
    labels?.zh,
    labels?.en,
    labels?.ja,
    ...Object.values(labels || {}),
    ...(aliases ? Object.values(aliases).flat() : []),
  ].filter((value): value is string => Boolean(value?.trim()));
  return candidates.find((value) => !isEntityIdLabel(value)) || candidates[0] || '';
}

export function isEntityIdLabel(value: string): boolean {
  return /^(?:wd:Q\d+|(?:douban|ndl|aozora|club|gutenberg|cwa|edgar|tuiliz):)/i.test(value.trim());
}
