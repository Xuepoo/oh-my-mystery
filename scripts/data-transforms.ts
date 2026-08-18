import { createHash } from 'node:crypto';

export interface SourceFact {
  subject_id: string;
  predicate: string;
  object_ref?: string | null;
  object_value?: string | null;
  qualifiers_json?: string | null;
  source?: string | null;
}

export interface AggregatedFact extends SourceFact {
  object_ref: string;
}

export interface WorkCandidate {
  id: string;
  names_json: string;
  author_ids: string[];
}

export interface WorkGroup {
  id: string;
  representativeId: string;
  normalizedTitle: string;
  authorIds: string[];
  memberIds: string[];
}

export interface RecommendationScore {
  score: number;
  reasons: string[];
}

const CANONICAL_PREDICATES: Record<string, string> = {
  P50: 'author',
  P166: 'award_received',
  award: 'award_received',
  P674: 'characters',
  character: 'characters',
  P179: 'series',
};

function parseQualifiers(raw?: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stableObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function aggregateFacts(
  facts: SourceFact[],
  resolveId: (id: string) => string,
): AggregatedFact[] {
  const groups = new Map<string, { fact: AggregatedFact; assertions: Map<string, object> }>();
  for (const fact of facts) {
    const subjectId = resolveId(fact.subject_id);
    const objectRef = fact.object_ref ? resolveId(fact.object_ref) : '';
    const objectValue = fact.object_value?.trim() || null;
    const predicate = CANONICAL_PREDICATES[fact.predicate] || fact.predicate;
    const key = JSON.stringify([subjectId, predicate, objectRef, objectValue]);
    let group = groups.get(key);
    if (!group) {
      group = {
        fact: {
          ...fact,
          subject_id: subjectId,
          predicate,
          object_ref: objectRef,
          object_value: objectValue,
        },
        assertions: new Map(),
      };
      groups.set(key, group);
    }
    const assertion = stableObject({
      ...parseQualifiers(fact.qualifiers_json),
      ...(fact.source ? { source: fact.source } : {}),
    });
    group.assertions.set(JSON.stringify(assertion), assertion);
  }

  return [...groups.values()].map(({ fact, assertions }) => {
    const evidence = [...assertions.values()].sort(
      (left: any, right: any) =>
        String(left.source || '').localeCompare(String(right.source || '')) ||
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
    const sources = [...new Set(evidence.flatMap((item: any) => item.source || []))].sort();
    return {
      ...fact,
      qualifiers_json: evidence.length ? JSON.stringify({ assertions: evidence }) : null,
      source: sources.join(', ') || null,
    };
  });
}

function readableTitle(rawNames: string): string {
  try {
    const labels = JSON.parse(rawNames)?.labels || {};
    for (const language of ['zh', 'zh-cn', 'ja', 'en', '']) {
      if (typeof labels[language] === 'string' && labels[language].trim()) return labels[language];
    }
    return Object.values(labels).find((value) => typeof value === 'string') as string;
  } catch {
    return '';
  }
}

function normalizeWorkTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[《》「」『』“”‘’\s·・•.,，。:：;；!?！？()（）[\]【】_-]/gu, '');
}

function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function buildWorkGroups(candidates: WorkCandidate[]): WorkGroup[] {
  const groups = new Map<string, WorkCandidate[]>();
  for (const candidate of candidates) {
    const title = normalizeWorkTitle(readableTitle(candidate.names_json));
    if (!title) continue;
    const authors = [...new Set(candidate.author_ids)].sort();
    const key = JSON.stringify([title, authors.length ? authors : [candidate.id]]);
    const members = groups.get(key) || [];
    members.push(candidate);
    groups.set(key, members);
  }

  return [...groups.entries()].map(([key, members]) => {
    members.sort((left, right) => {
      const canonical = Number(right.id.startsWith('wd:')) - Number(left.id.startsWith('wd:'));
      return canonical || left.id.localeCompare(right.id);
    });
    const [normalizedTitle, authorIds] = JSON.parse(key) as [string, string[]];
    return {
      id: `work-group:${hashString(key)}`,
      representativeId: members[0]!.id,
      normalizedTitle,
      authorIds,
      memberIds: members.map((member) => member.id).sort(),
    };
  });
}

export function addRecommendationSignal(
  scores: Map<string, RecommendationScore>,
  targetId: string,
  score: number,
  reason: string,
): void {
  const current = scores.get(targetId) || { score: 0, reasons: [] };
  current.score = Math.max(current.score, score);
  if (!current.reasons.includes(reason)) current.reasons.push(reason);
  current.reasons.sort();
  scores.set(targetId, current);
}
