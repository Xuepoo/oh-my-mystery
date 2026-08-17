import { Entity } from '@vectojs/core';
import type { StatsResponse } from '@omm/shared';
import type { D1DataSource } from '../api/D1DataSource';
import type { GraphViewport } from '../scene/GraphViewport';
import { getCanvasCtx, Theme } from './theme';
import { fitFontSize, truncateText, withClip } from './text-layout';

const TYPE_LABELS: Record<string, string> = {
  author: '作家',
  work: '作品',
  award: '奖项',
  character: '角色',
  publisher: '出版社',
  series: '系列',
};

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface GraphStatsLayout {
  toggle: Rect;
  modal: Rect;
  close: Rect;
  cards: Rect[];
  columns: number;
  typeY: number;
  typeRows: number;
  typeRowHeight: number;
}

export function getGraphStatsLayout(width: number, height: number): GraphStatsLayout {
  const compact = width < 480;
  const toggle = {
    x: compact ? width - 60 : 16,
    y: compact ? 76 : 128,
    w: compact ? 44 : 96,
    h: 44,
  };
  const modalW = Math.max(0, Math.min(560, width - 32));
  const modalH = Math.max(0, Math.min(500, height - 40));
  const modal = { x: (width - modalW) / 2, y: (height - modalH) / 2, w: modalW, h: modalH };
  const close = { x: modal.x + modal.w - 52, y: modal.y + 10, w: 44, h: 44 };
  const columns = width < 520 ? 2 : 3;
  const gap = 10;
  const cardRows = Math.ceil(6 / columns);
  const cardRowGap = 8;
  const cardH = Math.max(0, Math.min(52, (modal.h - 78 - cardRowGap * (cardRows - 1)) / cardRows));
  const cardW = Math.max(0, (modal.w - 44 - gap * (columns - 1)) / columns);
  const cardY = modal.y + 66;
  const cards = Array.from({ length: 6 }, (_, index) => ({
    x: modal.x + 22 + (index % columns) * (cardW + gap),
    y: cardY + Math.floor(index / columns) * (cardH + cardRowGap),
    w: cardW,
    h: cardH,
  }));
  const cardsBottom = cards.at(-1)!.y + cardH;
  const typeY = cardsBottom + 18;
  const typeRowHeight = 30;
  const lastRowY = modal.y + modal.h - 28;
  const typeRows = Math.max(
    0,
    Math.min(6, Math.floor((lastRowY - (typeY + 24)) / typeRowHeight) + 1),
  );

  return { toggle, modal, close, cards, columns, typeY, typeRows, typeRowHeight };
}

export class GraphStatsPanel extends Entity {
  private readonly source: D1DataSource;
  private readonly viewport: GraphViewport;
  private stats: StatsResponse | null = null;

  get toggleRect(): Rect {
    return getGraphStatsLayout(this.scene?.width ?? 1280, this.scene?.height ?? 800).toggle;
  }
  private open = false;
  private loading = false;
  private enabled = true;

  constructor(source: D1DataSource, viewport: GraphViewport) {
    super();
    this.id = 'graph-stats-panel';
    this.interactive = true;
    this.source = source;
    this.viewport = viewport;
  }

  isPanelOpen(): boolean {
    return this.open;
  }

  getInstrumentationTargets(): readonly { id: string; rect: Rect }[] {
    if (!this.enabled) return [];
    const layout = getGraphStatsLayout(this.scene?.width ?? 1280, this.scene?.height ?? 800);
    return this.open
      ? [
          { id: 'tool.stats', rect: { ...layout.toggle } },
          { id: 'tool.stats.close', rect: { ...layout.close } },
        ]
      : [{ id: 'tool.stats', rect: { ...layout.toggle } }];
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.scene?.markDirty();
  }

  isPointInside(x: number, y: number): boolean {
    if (!this.enabled) return false;
    if (this.open) return true;
    return this.inRect(x, y, getGraphStatsLayout(this.scene.width, this.scene.height).toggle);
  }

  handleClick(x: number, y: number): boolean {
    if (!this.enabled) return false;
    const layout = getGraphStatsLayout(this.scene.width, this.scene.height);
    if (!this.open) {
      if (!this.inRect(x, y, layout.toggle)) return false;
      this.open = true;
      this.loadStats();
      this.scene.markDirty();
      return true;
    }
    if (this.inRect(x, y, layout.close) || !this.inRect(x, y, layout.modal)) {
      this.close();
    }
    return true;
  }

  render(r: any): void {
    if (!this.enabled) return;
    const ctx = getCanvasCtx(r);
    ctx.save();
    try {
      const layout = getGraphStatsLayout(this.scene.width, this.scene.height);
      this.drawButton(ctx, layout.toggle, this.scene.width < 480 ? '▥' : '图谱统计');
      if (!this.open) return;

      ctx.fillStyle = 'rgba(8, 6, 5, 0.72)';
      ctx.fillRect(0, 0, this.scene.width, this.scene.height);
      ctx.fillStyle = 'rgba(28, 21, 16, 0.98)';
      ctx.beginPath();
      ctx.roundRect(layout.modal.x, layout.modal.y, layout.modal.w, layout.modal.h, 12);
      ctx.fill();
      ctx.strokeStyle = Theme.colors.borderHighlight;
      ctx.stroke();

      withClip(ctx, layout.modal, () => this.drawModalContent(ctx, layout));
    } finally {
      ctx.restore();
    }
  }

  private drawModalContent(ctx: CanvasRenderingContext2D, layout: GraphStatsLayout): void {
    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `700 20px ${Theme.fonts.serif}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      truncateText(ctx, '图谱统计与覆盖率', Math.max(0, layout.modal.w - 88)),
      layout.modal.x + 22,
      layout.modal.y + 32,
    );
    this.drawButton(ctx, layout.close, '×');

    const nodes = this.viewport.getNodes();
    const links = this.viewport.getLinks();
    const byType = new Map<string, number>();
    for (const node of nodes) byType.set(node.type, (byType.get(node.type) || 0) + 1);
    const coverage = this.stats?.total ? (nodes.length / this.stats.total) * 100 : 0;
    const cards = [
      ['当前节点', nodes.length.toLocaleString()],
      ['当前关系', links.length.toLocaleString()],
      ['隐藏节点', this.viewport.getHiddenNodes().length.toLocaleString()],
      ['全库实体', this.stats?.total.toLocaleString() || '…'],
      ['全库关系/属性', this.stats?.facts.toLocaleString() || '…'],
      ['加载覆盖率', this.stats ? `${coverage.toFixed(2)}%` : '…'],
    ];
    for (let i = 0; i < cards.length; i++) {
      const rect = layout.cards[i]!;
      this.drawStatCard(ctx, rect.x, rect.y, rect.w, rect.h, cards[i]!);
    }

    const types = [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, layout.typeRows);
    if (types.length) {
      ctx.fillStyle = Theme.colors.textMid;
      ctx.font = `700 13px ${Theme.fonts.sans}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('当前子图节点类型', layout.modal.x + 22, layout.typeY);
      const max = Math.max(1, ...types.map(([, count]) => count));
      for (let i = 0; i < types.length; i++) {
        const [type, count] = types[i]!;
        const y = layout.typeY + 24 + i * layout.typeRowHeight;
        ctx.fillStyle = Theme.colors.textMuted;
        ctx.font = `600 11px ${Theme.fonts.sans}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(truncateText(ctx, TYPE_LABELS[type] || type, 66), layout.modal.x + 22, y);
        const barX = layout.modal.x + 96;
        const barW = Math.max(0, layout.modal.w - 154);
        ctx.fillStyle = 'rgba(243, 196, 118, 0.13)';
        ctx.fillRect(barX, y - 7, barW, 12);
        ctx.fillStyle = Theme.getNodeColor(type);
        ctx.fillRect(barX, y - 7, barW * (count / max), 12);
        ctx.fillStyle = Theme.colors.textHigh;
        ctx.textAlign = 'right';
        ctx.fillText(String(count), layout.modal.x + layout.modal.w - 24, y);
      }
    }
    if (this.loading) {
      ctx.fillStyle = Theme.colors.textMuted;
      ctx.font = `600 11px ${Theme.fonts.sans}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('正在读取全库统计…', layout.modal.x + 22, layout.modal.y + layout.modal.h - 16);
    }
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.close();
    this.scene?.markDirty();
  }

  private loadStats(): void {
    if (this.loading || this.stats) return;
    this.loading = true;
    void this.source.fetchStats().then((stats) => {
      this.stats = stats;
      this.loading = false;
      this.scene?.markDirty();
    });
  }

  private drawStatCard(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    data: string[],
  ): void {
    withClip(ctx, { x, y, w, h }, () => {
      ctx.fillStyle = 'rgba(50, 39, 30, 0.82)';
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 8);
      ctx.fill();
      // Text state may be inherited from the close button (center/middle),
      // which pushed the label and value out of the clipped card. Reset
      // explicitly so labels stay readable and inside the card.
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = Theme.colors.textMuted;
      ctx.font = `600 10px ${Theme.fonts.sans}`;
      ctx.fillText(truncateText(ctx, data[0]!, w - 24), x + 12, y + 18);
      ctx.fillStyle = Theme.colors.textHigh;
      fitFontSize(ctx, data[1]!, w - 24, 18, 12, (size) => `700 ${size}px ${Theme.fonts.serif}`);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(truncateText(ctx, data[1]!, w - 24), x + 12, y + h - 12);
    });
  }

  private drawButton(
    ctx: CanvasRenderingContext2D,
    rect: { x: number; y: number; w: number; h: number },
    label: string,
  ): void {
    ctx.fillStyle = 'rgba(30, 24, 19, 0.94)';
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 8);
    ctx.fill();
    ctx.strokeStyle = Theme.colors.border;
    ctx.stroke();
    ctx.fillStyle = Theme.colors.textMid;
    ctx.font = `600 11px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);
  }

  private inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }
}
