import { Entity } from '@vectojs/core';
import type { EntityDetailResponse } from '@omm/shared';
import { Theme } from './theme';

export interface CasefileDrawerOptions {
  onClose: () => void;
  onSelectEntity: (id: string) => void;
  onStartPathfinder: (id: string, name: string) => void;
  onExpandNode: (id: string) => void;
}

export class CasefileDrawer extends Entity {
  private details: EntityDetailResponse | null = null;
  private isOpen = false;
  private scrollY = 0;
  private maxScrollY = 0;
  private onCloseCb: () => void;
  private onSelectEntityCb: (id: string) => void;
  private onStartPathfinderCb: (id: string, name: string) => void;
  private onExpandNodeCb: (id: string) => void;

  private closeBtnRect = { x: 0, y: 0, w: 32, h: 32 };
  private pathfinderBtnRect = { x: 0, y: 0, w: 140, h: 36 };
  private expandBtnRect = { x: 0, y: 0, w: 140, h: 36 };
  private recItemRects: { id: string; name: string; x: number; y: number; w: number; h: number }[] =
    [];

  constructor(options: CasefileDrawerOptions) {
    super();
    this.id = 'casefile-drawer';
    this.interactive = true;
    this.onCloseCb = options.onClose;
    this.onSelectEntityCb = options.onSelectEntity;
    this.onStartPathfinderCb = options.onStartPathfinder;
    this.onExpandNodeCb = options.onExpandNode;

    this.on('pointerdown', (e: any) => {
      if (!this.isOpen) return;
      this.handleClick(e.clientX, e.clientY);
    });

    this.on('wheel', (e: any) => {
      if (!this.isOpen) return;
      this.scrollY = Math.max(0, Math.min(this.maxScrollY, this.scrollY + e.deltaY * 0.6));
    });
  }

  isPointInside(x: number, _y: number): boolean {
    if (!this.isOpen) return false;
    const drawerWidth = Math.min(420, this.scene.width * 0.9);
    return x >= this.scene.width - drawerWidth;
  }

  open(details: EntityDetailResponse): void {
    this.details = details;
    this.isOpen = true;
    this.scrollY = 0;
  }

  close(): void {
    this.isOpen = false;
    this.details = null;
    this.onCloseCb();
  }

  isDrawerOpen(): boolean {
    return this.isOpen;
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.isOpen || !this.details) return;

    const drawerWidth = Math.min(420, this.scene.width * 0.9);
    const drawerHeight = this.scene.height;
    const startX = this.scene.width - drawerWidth;

    // 1. Drawer Container Background & Shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetX = -6;

    ctx.fillStyle = Theme.colors.bgParchmentDark;
    ctx.fillRect(startX, 0, drawerWidth, drawerHeight);
    ctx.restore();

    // Left Accent Border (Parchment Line)
    ctx.strokeStyle = Theme.colors.borderAccent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX, 0);
    ctx.lineTo(startX, drawerHeight);
    ctx.stroke();

    // 2. Header Content
    const entity = this.details.entity;
    const labels = entity.names?.labels || {};
    const primaryName = labels.zh || labels['zh-cn'] || labels.en || labels.ja || entity.id;
    const subtitle = labels.en !== primaryName ? labels.en : labels.ja || '';

    let curY = 24 - this.scrollY;

    // Header Bar
    // Close Button [✕]
    this.closeBtnRect = { x: startX + drawerWidth - 44, y: 16, w: 32, h: 32 };
    ctx.fillStyle = Theme.colors.bgCard;
    ctx.beginPath();
    ctx.roundRect(
      this.closeBtnRect.x,
      this.closeBtnRect.y,
      this.closeBtnRect.w,
      this.closeBtnRect.h,
      6,
    );
    ctx.fill();
    ctx.strokeStyle = Theme.colors.border;
    ctx.stroke();

    ctx.fillStyle = Theme.colors.textMid;
    ctx.font = `600 16px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✕', this.closeBtnRect.x + 16, this.closeBtnRect.y + 16);

    // Entity Type Badge
    const typeLabel = Theme.getNodeTypeLabel(entity.type);
    const typeColor = Theme.getNodeColor(entity.type);

    ctx.fillStyle = typeColor;
    ctx.beginPath();
    ctx.roundRect(startX + 24, curY, 110, 24, 4);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 11px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(typeLabel, startX + 24 + 55, curY + 12);
    curY += 34;

    // Primary Title
    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `700 22px ${Theme.fonts.serif}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(primaryName, startX + 24, curY);
    curY += 28;

    // Subtitle & Country/Dates
    if (subtitle) {
      ctx.fillStyle = Theme.colors.textLow;
      ctx.font = `500 13px ${Theme.fonts.sans}`;
      ctx.fillText(subtitle, startX + 24, curY);
      curY += 20;
    }

    const metaParts = [];
    if (entity.birth || entity.death) {
      metaParts.push(`${entity.birth || '?'} ~ ${entity.death || 'Present'}`);
    }
    if (entity.country) {
      metaParts.push(`国籍: ${entity.country}`);
    }
    if (metaParts.length > 0) {
      ctx.fillStyle = Theme.colors.borderHighlight;
      ctx.font = `600 12px ${Theme.fonts.sans}`;
      ctx.fillText(metaParts.join('  |  '), startX + 24, curY);
      curY += 26;
    }

    // Divider
    ctx.strokeStyle = Theme.colors.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(startX + 24, curY);
    ctx.lineTo(startX + drawerWidth - 24, curY);
    ctx.stroke();
    curY += 18;

    // 3. Biography / Description
    if (entity.bio) {
      ctx.fillStyle = Theme.colors.textMid;
      ctx.font = `400 13px ${Theme.fonts.serif}`;
      const bioLines = this.wrapText(ctx, entity.bio, drawerWidth - 48);
      for (const line of bioLines.slice(0, 5)) {
        ctx.fillText(line, startX + 24, curY);
        curY += 20;
      }
      curY += 12;
    }

    // 4. Action Buttons
    const btnY = curY;
    this.pathfinderBtnRect = { x: startX + 24, y: btnY, w: 160, h: 34 };
    this.expandBtnRect = { x: startX + 196, y: btnY, w: 160, h: 34 };

    // Pathfinder Btn
    ctx.fillStyle = Theme.colors.bgCard;
    ctx.beginPath();
    ctx.roundRect(
      this.pathfinderBtnRect.x,
      this.pathfinderBtnRect.y,
      this.pathfinderBtnRect.w,
      this.pathfinderBtnRect.h,
      6,
    );
    ctx.fill();
    ctx.strokeStyle = Theme.colors.borderHighlight;
    ctx.stroke();

    ctx.fillStyle = Theme.colors.borderHighlight;
    ctx.font = `600 12px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔗 以此为起点探路', this.pathfinderBtnRect.x + 80, this.pathfinderBtnRect.y + 17);

    // Expand Btn
    ctx.fillStyle = Theme.colors.bgCard;
    ctx.beginPath();
    ctx.roundRect(
      this.expandBtnRect.x,
      this.expandBtnRect.y,
      this.expandBtnRect.w,
      this.expandBtnRect.h,
      6,
    );
    ctx.fill();
    ctx.strokeStyle = Theme.colors.border;
    ctx.stroke();

    ctx.fillStyle = Theme.colors.textMid;
    ctx.fillText('🔄 展开 1-Hop 关联', this.expandBtnRect.x + 80, this.expandBtnRect.y + 17);

    curY += 50;

    // 5. Top-N Recommendations Section
    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `700 15px ${Theme.fonts.serif}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('🌟 智能关联与推荐 (Recommendations)', startX + 24, curY);
    curY += 26;

    this.recItemRects = [];
    const recs = this.details.recommendations || [];
    if (recs.length === 0) {
      ctx.fillStyle = Theme.colors.textLow;
      ctx.font = `400 13px ${Theme.fonts.sans}`;
      ctx.fillText('暂无离线推荐条目', startX + 24, curY);
      curY += 24;
    } else {
      for (const rec of recs) {
        const cardH = 54;
        const cardW = drawerWidth - 48;
        const cardX = startX + 24;
        const cardY = curY;

        this.recItemRects.push({
          id: rec.target_id,
          name: rec.target_name,
          x: cardX,
          y: cardY,
          w: cardW,
          h: cardH,
        });

        // Card bg
        ctx.fillStyle = Theme.colors.bgCard;
        ctx.beginPath();
        ctx.roundRect(cardX, cardY, cardW, cardH, 6);
        ctx.fill();
        ctx.strokeStyle = Theme.colors.border;
        ctx.stroke();

        // Target type indicator
        ctx.fillStyle = Theme.getNodeColor(rec.target_type);
        ctx.beginPath();
        ctx.roundRect(cardX + 10, cardY + 12, 6, 30, 3);
        ctx.fill();

        // Target name
        ctx.fillStyle = Theme.colors.textHigh;
        ctx.font = `600 14px ${Theme.fonts.serif}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(rec.target_name, cardX + 24, cardY + 10);

        // Reason & Score
        ctx.fillStyle = Theme.colors.textLow;
        ctx.font = `400 12px ${Theme.fonts.sans}`;
        ctx.fillText(
          `${rec.reason} · 关联度 ${(rec.score * 100).toFixed(0)}%`,
          cardX + 24,
          cardY + 30,
        );

        curY += cardH + 10;
      }
    }

    this.maxScrollY = Math.max(0, curY + this.scrollY - drawerHeight + 40);
  }

  private handleClick(clientX: number, clientY: number): void {
    if (!this.details) return;

    // Check Close button
    if (this.isInRect(clientX, clientY, this.closeBtnRect)) {
      this.close();
      return;
    }

    // Check Pathfinder button
    if (this.isInRect(clientX, clientY, this.pathfinderBtnRect)) {
      const labels = this.details.entity.names?.labels || {};
      const name = labels.zh || labels['zh-cn'] || labels.en || this.details.entity.id;
      this.onStartPathfinderCb(this.details.entity.id, name);
      return;
    }

    // Check Expand button
    if (this.isInRect(clientX, clientY, this.expandBtnRect)) {
      this.onExpandNodeCb(this.details.entity.id);
      return;
    }

    // Check Recommendation cards
    for (const rect of this.recItemRects) {
      if (this.isInRect(clientX, clientY, rect)) {
        this.onSelectEntityCb(rect.id);
        return;
      }
    }
  }

  private isInRect(
    x: number,
    y: number,
    r: { x: number; y: number; w: number; h: number },
  ): boolean {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  private wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const lines: string[] = [];
    let currentLine = '';
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const testLine = currentLine + char;
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && currentLine !== '') {
        lines.push(currentLine);
        currentLine = char;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  }
}
