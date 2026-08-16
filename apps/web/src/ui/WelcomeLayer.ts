import { Entity } from '@vectojs/core';
import type { StatsResponse } from '@omm/shared';
import type { D1DataSource } from '../api/D1DataSource';
import { getCanvasCtx, Theme } from './theme';
import { truncateText, wrapText, withClip } from './text-layout';

export interface WelcomeLayerOptions {
  source: D1DataSource;
  onSelectEntity: (id: string) => void;
  onOpenHelp: () => void;
  onVisibilityChange?: (visible: boolean) => void;
}

interface FeaturedEntry {
  id: string;
  label: string;
  note: string;
  rect: { x: number; y: number; w: number; h: number };
}

const DISMISS_KEY = 'omm-welcome-dismissed';

export class WelcomeLayer extends Entity {
  private source: D1DataSource;
  private onSelectEntityCb: (id: string) => void;
  private onOpenHelpCb: () => void;
  private onVisibilityChangeCb: (visible: boolean) => void;

  private visible = true;
  private stats: StatsResponse | null = null;
  private cardRect = { x: 0, y: 0, w: 0, h: 0 };
  private closeBtnRect = { x: 0, y: 0, w: 28, h: 28 };
  private wanderBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private helpBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private featured: FeaturedEntry[] = [
    {
      id: 'wd:Q35064',
      label: '阿加莎·克里斯蒂',
      note: '侦探女王',
      rect: { x: 0, y: 0, w: 0, h: 0 },
    },
    { id: 'wd:Q125970', label: '东野圭吾', note: '平成推理天王', rect: { x: 0, y: 0, w: 0, h: 0 } },
    { id: 'wd:Q16867', label: '爱伦·坡', note: '侦探小说之父', rect: { x: 0, y: 0, w: 0, h: 0 } },
    {
      id: 'wd:Q347412',
      label: '江户川乱步',
      note: '日系本格宗师',
      rect: { x: 0, y: 0, w: 0, h: 0 },
    },
  ];

  constructor(options: WelcomeLayerOptions) {
    super();
    this.id = 'welcome-layer';
    this.interactive = true;
    this.source = options.source;
    this.onSelectEntityCb = options.onSelectEntity;
    this.onOpenHelpCb = options.onOpenHelp;
    this.onVisibilityChangeCb = options.onVisibilityChange || (() => {});

    if (typeof localStorage !== 'undefined') {
      this.visible = localStorage.getItem(DISMISS_KEY) !== '1';
    }
    if (this.visible) {
      void this.source.fetchStats().then((stats) => {
        this.stats = stats;
        this.scene?.markDirty();
      });
    }
  }

  isPointInside(x: number, y: number): boolean {
    if (!this.visible) return false;
    return this.isInRect(x, y, this.cardRect);
  }

  dismiss(): void {
    if (!this.visible) return;
    this.visible = false;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DISMISS_KEY, '1');
    }
    this.scene?.markDirty();
    this.onVisibilityChangeCb(false);
  }

  isVisible(): boolean {
    return this.visible;
  }

  private isInRect(
    x: number,
    y: number,
    r: { x: number; y: number; w: number; h: number },
  ): boolean {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  private async wander(): Promise<void> {
    const seeds = await this.source.fetchSeeds();
    if (seeds.length === 0) return;
    const pick = seeds[Math.floor(Math.random() * seeds.length)]!;
    this.onSelectEntityCb(pick.id);
  }

  handleClick(clientX: number, clientY: number): boolean {
    if (!this.visible) return false;

    if (this.isInRect(clientX, clientY, this.closeBtnRect)) {
      this.dismiss();
      return true;
    }
    for (const f of this.featured) {
      if (this.isInRect(clientX, clientY, f.rect)) {
        this.onSelectEntityCb(f.id);
        return true;
      }
    }
    if (this.isInRect(clientX, clientY, this.wanderBtnRect)) {
      void this.wander();
      return true;
    }
    if (this.isInRect(clientX, clientY, this.helpBtnRect)) {
      this.onOpenHelpCb();
      return true;
    }
    if (this.isInRect(clientX, clientY, this.cardRect)) {
      return true;
    }
    return false;
  }

  render(r: { width: number; height: number }): void {
    if (!this.visible) return;

    const ctx = getCanvasCtx(r);
    const w = this.scene.width;
    const isMobile = w < 768;

    const cardW = Math.min(360, w - 32);
    const cardX = isMobile ? 16 : 24;
    const cardY = isMobile ? 76 : 88;

    ctx.font = `700 15px ${Theme.fonts.serif}`;
    const padX = 20;
    const titleY = cardY + 20;

    const statsLine = 22;
    const descH = 40;
    const featuredRows = 2;
    const featuredH = featuredRows * 62 + 12;
    const ctaH = 44;
    const footerH = 26;
    const cardH = 24 + 34 + descH + statsLine + featuredH + ctaH + footerH + 16;

    this.cardRect = { x: cardX, y: cardY, w: cardW, h: cardH };

    // Card background
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 24;
    ctx.fillStyle = 'rgba(30, 24, 19, 0.88)';
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 12);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = Theme.colors.borderHighlight;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    let curY = titleY;

    // Title
    ctx.fillStyle = Theme.colors.borderHighlight;
    ctx.font = `700 19px ${Theme.fonts.serif}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(truncateText(ctx, '🕯️ 欢迎来到 OMM', cardW - padX * 2), cardX + padX, curY);
    curY += 34;

    // Description
    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `500 13px ${Theme.fonts.sans}`;
    const descriptionLines = wrapText(
      ctx,
      '以侦探视角漫游推理小说知识图谱: 点击作品追踪奖项,推演人物之间的隐藏关联。',
      cardW - padX * 2,
      2,
    );
    ctx.fillStyle = Theme.colors.textMid;
    withClip(ctx, { x: cardX + padX, y: curY, w: cardW - padX * 2, h: descH }, () => {
      descriptionLines.forEach((line, index) => {
        ctx.fillText(line, cardX + padX, curY + index * 20);
      });
    });
    curY += descH;

    // Stats line
    const byType = this.stats?.byType || {};
    const fmt = (n: number | undefined): string => (n ? n.toLocaleString('zh-CN') : '…');
    ctx.fillStyle = Theme.colors.textLow;
    ctx.font = `500 12px ${Theme.fonts.sans}`;
    const statsText = `${fmt(this.stats?.total)} 实体 · ${fmt(byType['work'])} 作品 · ${fmt(
      byType['author'],
    )} 作家 · ${fmt(byType['award'])} 奖项`;
    ctx.fillText(truncateText(ctx, statsText, cardW - padX * 2), cardX + padX, curY + 2);
    curY += statsLine;

    // Featured entries (2x2 grid)
    const gridX = cardX + padX;
    const gridW = cardW - padX * 2;
    const entryW = (gridW - 10) / 2;
    this.featured.forEach((f, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const ex = gridX + col * (entryW + 10);
      const ey = curY + row * 62;
      f.rect = { x: ex, y: ey, w: entryW, h: 54 };

      ctx.fillStyle = 'rgba(243, 196, 118, 0.10)';
      ctx.beginPath();
      ctx.roundRect(ex, ey, entryW, 54, 8);
      ctx.fill();
      ctx.strokeStyle = Theme.colors.border;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = Theme.colors.textHigh;
      ctx.font = `600 13px ${Theme.fonts.serif}`;
      ctx.fillText(f.label, ex + 12, ey + 10);

      ctx.fillStyle = Theme.colors.textLow;
      ctx.font = `500 11px ${Theme.fonts.sans}`;
      ctx.fillText(f.note, ex + 12, ey + 31);
    });
    curY += featuredH;

    // CTA row
    const btnW = (gridW - 10) / 2;
    this.wanderBtnRect = { x: gridX, y: curY, w: btnW, h: 34 };
    this.helpBtnRect = { x: gridX + btnW + 10, y: curY, w: btnW, h: 34 };

    ctx.fillStyle = Theme.colors.borderHighlight;
    ctx.beginPath();
    ctx.roundRect(this.wanderBtnRect.x, curY, btnW, 34, 6);
    ctx.fill();
    ctx.fillStyle = '#1A1715';
    ctx.font = `700 12px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎲 随机漫游', this.wanderBtnRect.x + btnW / 2, curY + 17);

    ctx.fillStyle = Theme.colors.bgCard;
    ctx.beginPath();
    ctx.roundRect(this.helpBtnRect.x, curY, btnW, 34, 6);
    ctx.fill();
    ctx.strokeStyle = Theme.colors.border;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = Theme.colors.textHigh;
    ctx.fillText('❓ 操作指南', this.helpBtnRect.x + btnW / 2, curY + 17);
    ctx.textAlign = 'left';
    curY += ctaH;

    // Footer
    ctx.fillStyle = Theme.colors.textLow;
    ctx.font = `500 11px ${Theme.fonts.sans}`;
    ctx.fillText('数据来源:Wikidata · 豆瓣 · 青空文库 · Edgar · CWA', cardX + padX, curY + 4);
    curY += footerH;

    // Close button (top-right of card)
    this.closeBtnRect = { x: cardX + cardW - 38, y: cardY + 12, w: 28, h: 28 };
    ctx.fillStyle = 'rgba(28, 24, 22, 0.7)';
    ctx.beginPath();
    ctx.roundRect(this.closeBtnRect.x, this.closeBtnRect.y, 28, 28, 6);
    ctx.fill();
    ctx.strokeStyle = Theme.colors.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = Theme.colors.textMid;
    ctx.font = `600 13px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✕', this.closeBtnRect.x + 14, this.closeBtnRect.y + 14);
    ctx.textAlign = 'left';
  }
}
