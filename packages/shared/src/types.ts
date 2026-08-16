export type EntityType =
  | 'author'
  | 'work'
  | 'award'
  | 'character'
  | 'series'
  | 'publisher'
  | 'genre'
  | 'person'
  | 'other';

export type LabelMap = Readonly<Record<string, string>>;

export interface EntityNames {
  labels: Record<string, string>;
  aliases?: Record<string, string[]>;
}

export interface OmmEntity {
  id: string;
  qid?: string | null;
  type: EntityType;
  names: EntityNames;
  bio?: string | null;
  birth?: string | null;
  death?: string | null;
  country?: string | null;
  source?: string;
  quality?: number;
}

export interface OmmFact {
  subject_id: string;
  predicate: string;
  object_ref: string;
  object_value?: string;
  qualifiers?: Record<string, unknown>;
  source?: string;
}

export interface RecommendationItem {
  target_id: string;
  target_name: string;
  target_type: EntityType;
  score: number;
  reason: string;
  rank: number;
}

export interface EntityDetailResponse {
  entity: OmmEntity;
  facts: OmmFact[];
  recommendations: RecommendationItem[];
}

export interface ChronicleStep {
  id: string;
  title: Record<string, string>;
  summary: Record<string, string>;
  primaryEntityId: string;
  focusEntityIds: string[];
  year?: number;
}

export interface ChronicleTrail {
  id: string;
  slug: string;
  title: Record<string, string>;
  description: Record<string, string>;
  steps: ChronicleStep[];
}

export interface PathfinderResult {
  found: boolean;
  nodes: OmmEntity[];
  edges: {
    source: string;
    target: string;
    predicate: string;
    storedSource?: string;
    storedTarget?: string;
  }[];
  hops: number;
  explanation?: string;
}

export interface SearchResultItem {
  id: string;
  type: EntityType;
  name: string;
  subtitle?: string;
  score: number;
}

export interface SearchResponse {
  query: string;
  results: SearchResultItem[];
}

export interface StatsResponse {
  total: number;
  byType: Record<string, number>;
  facts: number;
  awards: number;
}

/** Helper to pick a primary label from EntityNames given target language. */
export function getEntityDisplayName(names: EntityNames, lang = 'zh'): string {
  const labels = names.labels || {};
  if (labels[lang]) return labels[lang]!;
  if (labels['zh']) return labels['zh']!;
  if (labels['zh-cn']) return labels['zh-cn']!;
  if (labels['en']) return labels['en']!;
  if (labels['ja']) return labels['ja']!;
  if (labels['']) return labels['']!;
  const first = Object.values(labels)[0];
  return first || 'Unknown';
}
