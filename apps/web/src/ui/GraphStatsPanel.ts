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

export class GraphStatsPanel extends Entity {
  private readonly source: D1DataSource;
  private readonly viewport: GraphViewport;
  private stats: StatsResponse | null = null;
  private open = false;
  private loading = false;
  private toggleRect = { x: 16, y: 128, w: 96, h: 44 };
  private modalRect = { x: 0, y: 0, w: 0, h: 0 };
  private closeRect = { x: 0, y: 0, w: 44, h: 44 };
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

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.scene?.markDirty();
  }

  isPointInside(x: number, y: number): boolean {
    if (!this.enabled) return false;
    if (this.open) return true;
    return this.inRect(x, y, this.toggleRect);
  }

  handleClick(x: number, y: number): boolean {
    if (!this.enabled) return false;
    if (!this.open) {
      if (!this.inRect(x, y, this.toggleRect)) return false;
      this.open = true;
      this.loadStats();
      this.scene.markDirty();
      return true;
    }
    if (this.inRect(x, y, this.closeRect) || !this.inRect(x, y, this.modalRect)) {
      this.close();
    }
    return true;
  }

  render(r: any): void {
    if (!this.enabled) return;
    const ctx = getCanvasCtx(r);
    const compact = this.scene.width < 480;
    this.toggleRect = {
      x: compact ? this.scene.width - 60 : 16,
      y: compact ? 76 : 128,
      w: compact ? 44 : 96,
      h: 44,
    };
    this.drawButton(ctx, this.toggleRect, compact ? '▥' : '图谱统计');
    if (!this.open) return;

    ctx.fillStyle = 'rgba(8, 6, 5, 0.72)';
    ctx.fillRect(0, 0, this.scene.width, this.scene.height);
    const modalW = Math.min(560, this.scene.width - 32);
    const modalH = Math.min(500, this.scene.height - 40);
    const modalX = (this.scene.width - modalW) / 2;
    const modalY = (this.scene.height - modalH) / 2;
    this.modalRect = { x: modalX, y: modalY, w: modalW, h: modalH };
    ctx.fillStyle = 'rgba(28, 21, 16, 0.98)';
    ctx.beginPath();
    ctx.roundRect(modalX, modalY, modalW, modalH, 12);
    ctx.fill();
    ctx.strokeStyle = Theme.colors.borderHighlight;
    ctx.stroke();

    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `700 20px ${Theme.fonts.serif}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('图谱统计与覆盖率', modalX + 22, modalY + 32);
    this.closeRect = { x: modalX + modalW - 52, y: modalY + 10, w: 44, h: 44 };
    this.drawButton(ctx, this.closeRect, '×');

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
      ['全库事实', this.stats?.facts.toLocaleString() || '…'],
      ['加载覆盖率', this.stats ? `${coverage.toFixed(2)}%` : '…'],
    ];
    const columns = this.scene.width < 520 ? 2 : 3;
    const gap = 10;
    const cardW = (modalW - 44 - gap * (columns - 1)) / columns;
    for (let i = 0; i < cards.length; i++) {
      const col = i % columns;
      const row = Math.floor(i / columns);
      this.drawStatCard(
        ctx,
        modalX + 22 + col * (cardW + gap),
        modalY + 70 + row * 70,
        cardW,
        cards[i]!,
      );
    }

    const typeY = modalY + (columns === 2 ? 292 : 224);
    ctx.fillStyle = Theme.colors.textMid;
    ctx.font = `700 13px ${Theme.fonts.sans}`;
    ctx.fillText('当前子图节点类型', modalX + 22, typeY);
    const types = [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const max = Math.max(1, ...types.map(([, count]) => count));
    for (let i = 0; i < types.length; i++) {
      const [type, count] = types[i]!;
      const y = typeY + 24 + i * 30;
      ctx.fillStyle = Theme.colors.textMuted;
      ctx.font = `600 11px ${Theme.fonts.sans}`;
      ctx.fillText(TYPE_LABELS[type] || type, modalX + 22, y);
      const barX = modalX + 96;
      const barW = modalW - 154;
      ctx.fillStyle = 'rgba(243, 196, 118, 0.13)';
      ctx.fillRect(barX, y - 7, barW, 12);
      ctx.fillStyle = Theme.getNodeColor(type);
      ctx.fillRect(barX, y - 7, barW * (count / max), 12);
      ctx.fillStyle = Theme.colors.textHigh;
      ctx.textAlign = 'right';
      ctx.fillText(String(count), modalX + modalW - 24, y);
      ctx.textAlign = 'left';
    }
    if (this.loading) {
      ctx.fillStyle = Theme.colors.textMuted;
      ctx.fillText('正在读取全库统计…', modalX + 22, modalY + modalH - 22);
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
    data: string[],
  ): void {
    withClip(ctx, { x, y, w, h: 60 }, () => {
      ctx.fillStyle = 'rgba(50, 39, 30, 0.82)';
      ctx.beginPath();
      ctx.roundRect(x, y, w, 60, 8);
      ctx.fill();
      ctx.fillStyle = Theme.colors.textMuted;
      ctx.font = `600 10px ${Theme.fonts.sans}`;
      ctx.fillText(truncateText(ctx, data[0]!, w - 24), x + 12, y + 18);
      ctx.fillStyle = Theme.colors.textHigh;
      fitFontSize(ctx, data[1]!, w - 24, 18, 12, (size) => `700 ${size}px ${Theme.fonts.serif}`);
      ctx.fillText(truncateText(ctx, data[1]!, w - 24), x + 12, y + 42);
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
