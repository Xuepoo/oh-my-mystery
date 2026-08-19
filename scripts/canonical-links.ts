export interface QidCandidate {
  id: string;
  qid?: string | null;
}

export interface LabelCandidate {
  id: string;
  source: string;
  labels: string[];
}

export function buildQidLinks(candidates: readonly QidCandidate[]): Map<string, string> {
  const ids = new Set(candidates.map(({ id }) => id));
  const links = new Map<string, string>();
  for (const candidate of candidates) {
    if (!candidate.qid || !/^Q\d+$/u.test(candidate.qid)) continue;
    const target = `wd:${candidate.qid}`;
    if (candidate.id !== target && ids.has(target)) links.set(candidate.id, target);
  }
  return links;
}

export function buildUniqueWikidataLabelLinks(
  candidates: readonly LabelCandidate[],
): Map<string, string> {
  const targets = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    if (candidate.source !== 'wikidata') continue;
    for (const label of candidate.labels) {
      const key = normalizeLabel(label);
      if (!key) continue;
      const ids = targets.get(key) ?? new Set<string>();
      ids.add(candidate.id);
      targets.set(key, ids);
    }
  }

  const links = new Map<string, string>();
  for (const candidate of candidates) {
    if (candidate.source === 'wikidata') continue;
    const matches = new Set<string>();
    for (const label of candidate.labels) {
      const ids = targets.get(normalizeLabel(label));
      if (ids?.size === 1) matches.add([...ids][0]!);
    }
    if (matches.size === 1) links.set(candidate.id, [...matches][0]!);
  }
  return links;
}

function normalizeLabel(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s·・•._\-—_–|]+/gu, '');
}
