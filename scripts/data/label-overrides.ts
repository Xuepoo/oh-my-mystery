// Curated label overrides for known-bad source labels (Wikidata typos etc.).
// Applied AFTER generic cleaning during D1 import.
// Shape: { [entityId]: { labels?: Record<lang, string>, aliases?: Record<lang, string[]> } }
export interface LabelOverrides {
  labels?: Record<string, string>;
  aliases?: Record<string, string[]>;
}

export const LABEL_OVERRIDES: Record<string, LabelOverrides> = {
  // Wikidata zh label "横構正史" is a typo (ja label 横溝正史 is correct).
  'wd:Q1072588': {
    labels: { zh: '横沟正史', 'zh-cn': '横沟正史' },
  },
};
