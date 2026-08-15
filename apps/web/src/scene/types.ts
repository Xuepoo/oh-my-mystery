export type NodeId = string;

export interface GraphNode2D {
  id: string;
  type: string;
  name: string;
  color: string;
  val: number;
  labels: Record<string, string>;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
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
}

export function pickNodeLabel(labels: Record<string, string> | undefined, lang = 'zh'): string {
  if (!labels) return '';
  if (labels[lang]) return labels[lang];
  if (lang === 'zh' && labels['zh-cn']) return labels['zh-cn'];
  if (labels.zh) return labels.zh;
  if (labels.en) return labels.en;
  if (labels.ja) return labels.ja;
  const first = Object.values(labels)[0];
  return first || '';
}
