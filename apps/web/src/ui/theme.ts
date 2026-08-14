export const Theme = {
  colors: {
    bgNoir: '#181513',
    bgParchmentDark: '#1F1B18',
    bgCard: '#27221E',
    bgCardHover: '#322C27',
    bgSurfaceLight: '#F4EFE6',

    border: '#453E37',
    borderAccent: '#7D7064',
    borderHighlight: '#D4A373',

    textHigh: '#F5F1EB',
    textMid: '#C2B9AC',
    textLow: '#857C72',
    textMuted: '#5C544B',

    // Entity Badge Inks
    author: '#E09F3E', // Amber Gold (作家)
    work: '#457B9D', // Ocean Indigo (作品)
    award: '#BA181B', // Wax Seal Red (奖项)
    character: '#2A9D8F', // Emerald Detective (名侦探)
    series: '#8338EC', // Purple Ink (系列)
    publisher: '#7B2CBF', // Publisher
    genre: '#E76F51', // Terracotta
    other: '#6C757D', // Slate

    // Edges
    edgeDefault: 'rgba(120, 108, 96, 0.35)',
    edgeHover: 'rgba(212, 163, 115, 0.75)',
    edgeHighlighted: '#E9C46A', // Glowing clue thread
    edgePulse: '#F4A261',

    // Shadows
    shadowCard: 'rgba(0, 0, 0, 0.45)',
    shadowGlow: 'rgba(224, 159, 62, 0.25)',
  },

  fonts: {
    serif: "'Noto Serif SC', 'Cinzel', serif, Georgia",
    sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    mono: "'Fira Code', monospace",
  },

  radius: {
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    full: 9999,
  },

  getNodeColor(type: string): string {
    switch (type) {
      case 'author':
        return this.colors.author;
      case 'work':
        return this.colors.work;
      case 'award':
        return this.colors.award;
      case 'character':
        return this.colors.character;
      case 'series':
        return this.colors.series;
      case 'publisher':
        return this.colors.publisher;
      case 'genre':
        return this.colors.genre;
      default:
        return this.colors.other;
    }
  },

  getNodeTypeLabel(type: string): string {
    switch (type) {
      case 'author':
        return '作家 / Author';
      case 'work':
        return '作品 / Work';
      case 'award':
        return '奖项 / Award';
      case 'character':
        return '名侦探 / Character';
      case 'series':
        return '系列 / Series';
      case 'publisher':
        return '出版社 / Publisher';
      case 'genre':
        return '流派 / Genre';
      default:
        return '实体 / Entity';
    }
  },
};
