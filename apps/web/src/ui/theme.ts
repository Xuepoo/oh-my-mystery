export const Theme = {
  colors: {
    // Luminous Antique Mahogany & Warm Amber Parchment
    bgNoir: '#281F18', // Warm luminous mahogany
    bgParchmentDark: '#322720', // Rich warm parchment panel
    bgCard: '#40332A', // Brighter warm dossier card
    bgCardHover: '#4E3E33', // Card hover state
    bgSurfaceLight: '#FAF3E8', // Radiant vintage parchment
    bgPill: '#4A3B31',

    // Bright Gold & Brass Foil Accents
    border: '#6B5746', // Visible warm bronze border
    borderAccent: '#A3886E', // Mellow bright brass
    borderHighlight: '#F3C476', // Radiant luminous gold foil
    borderActive: '#FFD98E', // Brilliant lacquer gold

    // Ultra High Contrast Typography
    textHigh: '#FFFDF9', // Pure warm parchment ivory
    textMid: '#E4D5C3', // Warm antique linen
    textLow: '#B5A28E', // Legible warm sepia ink
    textMuted: '#8E7B69',

    // Radiant Jewel Entity Inks
    author: '#FFAB38', // Radiant Sun Amber (作家)
    work: '#50BAFF', // Glowing Celestial Azure (作品)
    award: '#FF4D5E', // Royal Imperial Crimson (奖项)
    character: '#34D399', // Brilliant Jade Emerald (名侦探)
    series: '#B78AF7', // Radiant Mythic Amethyst (系列)
    publisher: '#C084FC', // Luminous Orchid Violet (出版社)
    genre: '#FB923C', // Vivid Tangerine Ochre (流派)
    other: '#94A3B8', // Polished Silver (其他)

    // Radiant Relational Threads & Energy Pulses
    edgeDefault: 'rgba(243, 196, 118, 0.55)', // Radiant golden ink thread
    edgeHover: 'rgba(255, 171, 56, 0.95)',
    edgeHighlighted: '#FFE066', // Blazing clue connection
    edgePulse: '#FF9E00',

    // Atmosphere Glows
    shadowCard: 'rgba(0, 0, 0, 0.55)',
    shadowGlow: 'rgba(243, 196, 118, 0.45)',
    goldGlow: 'rgba(255, 217, 142, 0.65)',
  },

  fonts: {
    serif: "'Noto Serif SC', 'Cinzel', serif, Georgia, 'Songti SC'",
    sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', sans-serif",
    mono: "'Fira Code', 'Cascadia Code', monospace",
  },

  radius: {
    xs: 4,
    sm: 6,
    md: 9,
    lg: 14,
    xl: 18,
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
        return '名侦探 / Detective';
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

export function getCanvasCtx(r: any): CanvasRenderingContext2D {
  if (r && typeof r.getContext === 'function') {
    return r.getContext();
  }
  if (r && r.ctx) {
    return r.ctx;
  }
  return r as CanvasRenderingContext2D;
}
