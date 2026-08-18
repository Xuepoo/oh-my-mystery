export interface CountryNames {
  labels?: Record<string, unknown>;
}

export function countryLabelFromNames(rawNames: string | null | undefined): string | undefined {
  if (!rawNames) return undefined;
  try {
    const names = JSON.parse(rawNames) as CountryNames;
    const labels = names.labels || {};
    for (const language of ['zh', 'zh-cn', 'zh-hans', 'ja', 'en', '']) {
      const value = labels[language];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function normalizeCountryReference(country: string | null | undefined): string | undefined {
  if (!country) return undefined;
  const value = country.trim();
  if (!value) return undefined;
  if (value.startsWith('wd:')) return value.slice(3);
  return value;
}

export interface CountryEntityRow {
  qid?: string | null;
  names_json?: string | null;
}

export function buildCountryLabelMap(rows: CountryEntityRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const qid = normalizeCountryReference(row.qid);
    if (!qid) continue;
    const label = countryLabelFromNames(row.names_json);
    if (!label) continue;
    map.set(qid, label);
  }
  return map;
}
