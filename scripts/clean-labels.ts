// Label cleaning for the OMM D1 import pipeline.
// Applied to every names_json (labels + aliases) before entities/search_index are written.
import { LABEL_OVERRIDES } from './data/label-overrides';
import { ZH_T2S_MAP } from './data/zh-t2s-map';

const TRAILING_SEP_RE = /[，,·;；|、/\\\s]+$/;
// Hiragana + katakana, excluding U+30FB katakana middle dot which is
// punctuation used in zh transliterations like 謝爾・艾瑞克森.
const KANA_RE = /[\u3040-\u30fa\u30fc-\u30ff]/;

function stripControl(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) continue;
    out += ch;
  }
  return out;
}

function cleanSingle(raw: string): string {
  let s = raw.normalize('NFKC').trim();
  s = stripControl(s);
  s = s.replace(TRAILING_SEP_RE, '');
  return s;
}

function isZhLang(lang: string): boolean {
  return lang === 'zh' || lang === 'zh-cn' || lang === 'zh-hans' || lang === 'zh-hant';
}

// Unify zh labels/aliases to simplified Chinese for the zh-CN UI.
// Labels containing kana are Japanese-name renderings kept as-is
// (e.g. 乾くるみ must not become 干くるみ).
function toSimplified(s: string): string {
  if (KANA_RE.test(s)) return s;
  let out = '';
  for (const ch of s) {
    out += ZH_T2S_MAP[ch] ?? ch;
  }
  return out;
}

export interface CleanedNames {
  labels: Record<string, string>;
  aliases: Record<string, string[]>;
}

export function cleanNames(namesJson: string | null | undefined): CleanedNames {
  const result: CleanedNames = { labels: {}, aliases: {} };
  if (!namesJson) return result;

  let parsed: { labels?: unknown; aliases?: unknown };
  try {
    parsed = JSON.parse(namesJson);
  } catch {
    return result;
  }

  const labels = parsed.labels;
  if (labels && typeof labels === 'object') {
    for (const [lang, raw] of Object.entries(labels as Record<string, unknown>)) {
      if (typeof raw !== 'string') continue;
      const cleaned = cleanSingle(raw);
      if (!cleaned) continue;
      result.labels[lang] = isZhLang(lang) ? toSimplified(cleaned) : cleaned;
    }
  }

  const aliases = parsed.aliases;
  if (aliases && typeof aliases === 'object') {
    for (const [lang, rawArr] of Object.entries(aliases as Record<string, unknown>)) {
      if (!Array.isArray(rawArr)) continue;
      const seen = new Set<string>();
      const out: string[] = [];
      for (const raw of rawArr) {
        if (typeof raw !== 'string') continue;
        const cleaned = cleanSingle(raw);
        if (!cleaned) continue;
        const value = isZhLang(lang) ? toSimplified(cleaned) : cleaned;
        if (seen.has(value)) continue;
        seen.add(value);
        out.push(value);
      }
      if (out.length > 0) result.aliases[lang] = out;
    }
  }

  return result;
}

export function applyOverrides(id: string, names: CleanedNames): CleanedNames {
  const ov = LABEL_OVERRIDES[id];
  if (!ov) return names;
  if (ov.labels) {
    for (const [lang, value] of Object.entries(ov.labels)) {
      names.labels[lang] = value;
    }
  }
  if (ov.aliases) {
    for (const [lang, arr] of Object.entries(ov.aliases)) {
      names.aliases[lang] = arr;
    }
  }
  return names;
}

export function namesToJson(names: CleanedNames): string {
  return JSON.stringify(names);
}

const HEX_ONLY_RE = /^[0-9a-f]{8,}$/i;

// Junk entity names: no usable label at all, every label (and alias) is a
// hex-hash string (crawler bug), or an author entity whose name is a joined
// multi-author list (douban anthology bug).
export function isJunkNames(names: CleanedNames, type?: string): boolean {
  const labelVals = Object.values(names.labels).filter((v) => v.length > 0);
  if (labelVals.length === 0) return true;
  const aliasVals = Object.values(names.aliases).flat();
  const allHex =
    labelVals.every((v) => HEX_ONLY_RE.test(v)) &&
    (aliasVals.length === 0 || aliasVals.every((v) => HEX_ONLY_RE.test(v)));
  if (allHex) return true;
  if (type === 'author' && labelVals.some((v) => v.includes('、'))) return true;
  return false;
}
