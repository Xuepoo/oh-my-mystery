export interface PublisherCandidate {
  id: string;
  source: string;
  labels: string[];
}

const PUBLISHER_ALIASES = new Map([
  ['尖端', '尖端出版'],
  ['尖端社', '尖端出版'],
  ['英屬蓋曼群島商家庭傳媒股份有限公司城邦分公司尖端出版發行', '尖端出版'],
  ['獨步文化出版', '獨步文化'],
  ['春天出版國際文化', '春天出版國際'],
]);

export function normalizePublisherName(raw: string): string {
  let value = raw
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replaceAll('臺', '台')
    .replaceAll('独', '獨')
    .replaceAll('湾', '灣')
    .replaceAll('国', '國')
    .replaceAll('际', '際');
  value = value.replace(/^(株式会社|股份有限公司|股份公司|有限公司|\(株\)|（株）)/u, '');
  value = value
    .replace(/[\s（）()【】·•・,，.。:：]/gu, '')
    .replaceAll('[', '')
    .replaceAll(']', '');
  value = value.replace(/(股份有限公司|出版有限公司|出版公司|出版集團|出版集团|出版社)$/u, '');
  return PUBLISHER_ALIASES.get(value) ?? value;
}

export function isPublisherLiteral(value: string, authorNames: ReadonlySet<string>): boolean {
  const trimmed = value.normalize('NFKC').trim();
  if (!trimmed || ['[', ']', '【', '】', '／', '/'].some((part) => trimmed.includes(part)))
    return false;
  const names = trimmed
    .split(/[、，,]/u)
    .map(normalizePublisherName)
    .filter(Boolean);
  return names.length > 0 && names.every((name) => name.length >= 2 && !authorNames.has(name));
}

export function maySynthesizePublisher(value: string): boolean {
  return !/[、，,]/u.test(value.normalize('NFKC'));
}

export function matchPublisherName(
  value: string,
  publisherByName: ReadonlyMap<string, string>,
): string | null {
  const candidates = [value, ...value.split(/[、，,／/]/u)]
    .map(normalizePublisherName)
    .filter(Boolean);
  for (const key of candidates) {
    const direct = publisherByName.get(key);
    if (direct) return direct;
  }
  return null;
}

export function buildPublisherLinks(
  candidates: readonly PublisherCandidate[],
): Map<string, string> {
  const groups = new Map<string, PublisherCandidate[]>();
  for (const candidate of candidates) {
    const keys = [...new Set(candidate.labels.map(normalizePublisherName).filter(Boolean))];
    for (const key of keys) {
      const group = groups.get(key) ?? [];
      group.push(candidate);
      groups.set(key, group);
    }
  }

  const links = new Map<string, string>();
  for (const [key, group] of groups) {
    const unique = [...new Map(group.map((candidate) => [candidate.id, candidate])).values()];
    if (unique.length < 2) continue;
    unique.sort(
      (left, right) =>
        candidateRank(left, key) - candidateRank(right, key) || left.id.localeCompare(right.id),
    );
    const canonical = unique[0]!.id;
    for (const candidate of unique.slice(1)) links.set(candidate.id, canonical);
  }
  return links;
}

export function buildPublisherNameIndex(
  candidates: readonly PublisherCandidate[],
  links: ReadonlyMap<string, string>,
): Map<string, string> {
  const resolve = (id: string): string => {
    const seen = new Set<string>();
    while (links.has(id) && !seen.has(id)) {
      seen.add(id);
      id = links.get(id)!;
    }
    return id;
  };
  const index = new Map<string, string>();
  for (const candidate of [...candidates].sort((left, right) => left.id.localeCompare(right.id))) {
    const canonical = resolve(candidate.id);
    for (const label of candidate.labels) {
      const key = normalizePublisherName(label);
      if (key) index.set(key, canonical);
    }
  }
  return index;
}

function candidateRank(candidate: PublisherCandidate, key: string): number {
  const sourceRank = candidate.source === 'wikidata' ? 0 : candidate.source === 'douban' ? 10 : 20;
  const exactRank = candidate.labels.some(
    (label) => label.normalize('NFKC').trim().toLowerCase() === key,
  )
    ? 0
    : 1;
  return sourceRank + exactRank;
}
