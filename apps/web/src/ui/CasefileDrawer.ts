import { Entity } from '@vectojs/core';
import type { EntityDetailResponse } from '@omm/shared';
import { pickNodeLabel } from '../scene/types';
import { getCanvasCtx, Theme } from './theme';
import { truncateText } from './text-layout';

const ENTITY_TYPE_LABELS: Record<string, string> = {
  author: '作者',
  work: '作品',
  award: '奖项',
  character: '角色',
  series: '系列',
  publisher: '出版社',
  genre: '类型',
  person: '人物',
  other: '其他',
};

const PREDICATE_LABELS: Record<string, string> = {
  author: '作者',
  aozora_role: '创作',
  publisher: '出版社',
  publisher_name: '出版社',
  award: '奖项',
  award_received: '奖项',
  character: '角色',
  characters: '角色',
  series: '系列',
  translator: '译者',
  genre: '类型',
};

function formatCopyYear(value?: string | null): string {
  if (!value) return '';
  const match = value.match(/^[+-]?(\d{4})/);
  return match?.[1] || value;
}

export function formatEntityDetailsText(details: EntityDetailResponse): string {
  const { entity } = details;
  const labels = entity.names?.labels || {};
  const primaryName = pickNodeLabel(labels, 'zh', entity.names?.aliases) || entity.id;
  const lines = [`名称：${primaryName}`, `类型：${ENTITY_TYPE_LABELS[entity.type] || entity.type}`];

  if (labels.en && labels.en !== primaryName) lines.push(`英文名：${labels.en}`);
  if (entity.bio) lines.push(`简介：${entity.bio.trim()}`);
  if (entity.birth || entity.death) {
    lines.push(
      `生卒：${formatCopyYear(entity.birth) || '?'} ~ ${formatCopyYear(entity.death) || '至今'}`,
    );
  }
  if ((entity.type === 'author' || entity.type === 'person') && entity.country) {
    lines.push(`国籍：${entity.country}`);
  }

  const relationLines = new Set<string>();
  for (const fact of details.facts) {
    const value = (fact.object_value || fact.object_ref || '').trim();
    const predicate = PREDICATE_LABELS[fact.predicate.trim()] || fact.predicate.trim();
    if (!predicate || !value || value === entity.id) continue;
    relationLines.add(`${predicate}：${value}`);
  }
  if (relationLines.size > 0) lines.push('', '关系：', ...relationLines);
  lines.push(`来源 ID：${entity.id}`);
  return lines.join('\n');
}

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
  private anchor = { x: 0, y: 0 };
  private manualPosition: { x: number; y: number } | null = null;
  private dragging = false;
  private dragOffset = { x: 0, y: 0 };
  private cardRect = { x: -1000, y: -1000, w: 0, h: 0 };

  private closeBtnRect = { x: 0, y: 0, w: 32, h: 32 };
  private copyBtnRect = { x: 0, y: 0, w: 32, h: 32 };
  private pathfinderBtnRect = { x: 0, y: 0, w: 140, h: 36 };
  private expandBtnRect = { x: 0, y: 0, w: 140, h: 36 };
  private recItemRects: { id: string; name: string; x: number; y: number; w: number; h: number }[] =
    [];
  private copyState: 'idle' | 'success' | 'error' = 'idle';

  constructor(options: CasefileDrawerOptions) {
    super();
    this.id = 'casefile-drawer';
    this.interactive = true;
    this.onCloseCb = options.onClose;
    this.onSelectEntityCb = options.onSelectEntity;
    this.onStartPathfinderCb = options.onStartPathfinder;
    this.onExpandNodeCb = options.onExpandNode;
    // Pointer input is dispatched from App.ts canvas listeners (entity-level
    // events never fire without an a11y projection on this entity).
  }

  handleWheel(delta: number): void {
    if (!this.isOpen) return;
    this.scrollY = Math.max(0, Math.min(this.maxScrollY, this.scrollY + delta * 0.6));
    this.scene.markDirty();
  }

  isPointInside(x: number, y: number): boolean {
    if (!this.isOpen) return false;
    return this.isInRect(x, y, this.cardRect);
  }

  open(details: EntityDetailResponse, anchor?: { x: number; y: number }): void {
    this.details = details;
    this.isOpen = true;
    if (anchor) this.anchor = anchor;
    this.scrollY = 0;
    this.copyState = 'idle';
    this.scene.markDirty();
  }

  close(): void {
    this.isOpen = false;
    this.details = null;
    this.cardRect = { x: -1000, y: -1000, w: 0, h: 0 };
    this.copyState = 'idle';
    this.onCloseCb();
    this.scene.markDirty();
  }

  isDrawerOpen(): boolean {
    return this.isOpen;
  }

  isDragging(): boolean {
    return this.dragging;
  }

  handlePointerDown(x: number, y: number): boolean {
    if (!this.isOpen || !this.isInRect(x, y, this.cardRect)) return false;
    if (this.isInRect(x, y, this.closeBtnRect) || this.isInRect(x, y, this.copyBtnRect))
      return false;
    const headerBottom = this.cardRect.y + 72;
    if (y > headerBottom) return false;
    this.dragging = true;
    this.dragOffset = { x: x - this.cardRect.x, y: y - this.cardRect.y };
    return true;
  }

  handlePointerMove(x: number, y: number): boolean {
    if (!this.dragging) return false;
    const margin = 12;
    const maxX = Math.max(margin, this.scene.width - this.cardRect.w - margin);
    const maxY = Math.max(margin, this.scene.height - this.cardRect.h - margin);
    this.manualPosition = {
      x: Math.max(margin, Math.min(maxX, x - this.dragOffset.x)),
      y: Math.max(margin, Math.min(maxY, y - this.dragOffset.y)),
    };
    this.scene.markDirty();
    return true;
  }

  handlePointerUp(): boolean {
    if (!this.dragging) return false;
    this.dragging = false;
    return true;
  }

  render(r: any): void {
    if (!this.isOpen || !this.details) return;

    const ctx = getCanvasCtx(r);
    const margin = 16;
    const drawerWidth = Math.min(420, this.scene.width - margin * 2);
    const drawerHeight = Math.min(640, this.scene.height - 96);
    const isMobile = this.scene.width < 640;
    let startX = isMobile ? margin : this.anchor.x + 28;
    if (!isMobile && startX + drawerWidth > this.scene.width - margin) {
      startX = this.anchor.x - drawerWidth - 28;
    }
    startX = Math.max(margin, Math.min(this.scene.width - drawerWidth - margin, startX));
    let startY = isMobile
      ? 72
      : Math.max(72, Math.min(this.scene.height - drawerHeight - margin, this.anchor.y - 88));
    if (this.manualPosition) {
      startX = Math.max(
        margin,
        Math.min(this.scene.width - drawerWidth - margin, this.manualPosition.x),
      );
      startY = Math.max(
        margin,
        Math.min(this.scene.height - drawerHeight - margin, this.manualPosition.y),
      );
    }
    this.cardRect = { x: startX, y: startY, w: drawerWidth, h: drawerHeight };

    // 1. Floating card background & shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;

    ctx.fillStyle = Theme.colors.bgParchmentDark;
    ctx.beginPath();
    ctx.roundRect(startX, startY, drawerWidth, drawerHeight, 12);
    ctx.fill();
    ctx.restore();

    // Card border
    ctx.strokeStyle = Theme.colors.borderHighlight;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(startX, startY, drawerWidth, drawerHeight, 12);
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(startX, startY, drawerWidth, drawerHeight, 12);
    ctx.clip();

    // 2. Header Content
    const entity = this.details.entity;
    const labels = entity.names?.labels || {};
    const primaryName = pickNodeLabel(labels, 'zh', entity.names?.aliases) || entity.id;
    const subtitle = labels.en !== primaryName ? labels.en : labels.ja || '';

    let curY = startY + 24 - this.scrollY;

    // Header Bar
    // (close button is drawn last so scrolling content never overlaps it)
    this.closeBtnRect = { x: startX + drawerWidth - 44, y: startY + 16, w: 32, h: 32 };
    this.copyBtnRect = { x: startX + drawerWidth - 84, y: startY + 16, w: 32, h: 32 };

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
    ctx.fillText(truncateText(ctx, primaryName, drawerWidth - 160), startX + 24, curY);
    curY += 28;

    // Subtitle & Country/Dates
    if (subtitle) {
      ctx.fillStyle = Theme.colors.textMid;
      ctx.font = `500 13px ${Theme.fonts.sans}`;
      ctx.fillText(subtitle, startX + 24, curY);
      curY += 20;
    }

    const metaParts = [];
    if (entity.birth || entity.death) {
      const b = this.formatYear(entity.birth);
      const d = this.formatYear(entity.death);
      metaParts.push(`${b || '?'} ~ ${d || '至今'}`);
    }
    if ((entity.type === 'author' || entity.type === 'person') && entity.country) {
      metaParts.push(`国籍: ${this.formatCountry(entity.country)}`);
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
      ctx.fillStyle = Theme.colors.textHigh;
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
    const actionGap = 12;
    const actionW = (drawerWidth - 48 - actionGap) / 2;
    this.pathfinderBtnRect = { x: startX + 24, y: btnY, w: actionW, h: 34 };
    this.expandBtnRect = { x: startX + 24 + actionW + actionGap, y: btnY, w: actionW, h: 34 };

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
    ctx.fillText('🔗 以此探路', this.pathfinderBtnRect.x + actionW / 2, btnY + 17);

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

    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `600 12px ${Theme.fonts.sans}`;
    ctx.fillText('🔄 展开 / 收起', this.expandBtnRect.x + actionW / 2, btnY + 17);

    curY += 48;

    // 5. Recommendations List
    ctx.fillStyle = Theme.colors.borderHighlight;
    ctx.font = `700 15px ${Theme.fonts.serif}`;
    // Wax Seal Stamp (Procedural Antique Gold / Crimson Archive Seal)
    const sealX = startX + drawerWidth - 48;
    const sealY = startY + 112;
    ctx.save();
    ctx.strokeStyle = Theme.colors.borderHighlight;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sealX, sealY, 22, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(243, 196, 118, 0.4)';
    ctx.beginPath();
    ctx.arc(sealX, sealY, 18, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = Theme.colors.borderActive;
    ctx.font = `800 8px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('VERIFIED', sealX, sealY - 4);
    ctx.fillText('ARCHIVE', sealX, sealY + 6);
    ctx.restore();

    // 5. Smart Recommendations Section
    if (this.details.recommendations && this.details.recommendations.length > 0) {
      ctx.fillStyle = Theme.colors.borderHighlight;
      ctx.font = `700 14px ${Theme.fonts.serif}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('🌟 智能关联与推荐 (Recommendations)', startX + 24, curY);
      curY += 24;

      const cardW = drawerWidth - 48;
      const cardH = 52;

      this.recItemRects = [];
      for (const rec of this.details.recommendations) {
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
        ctx.fillStyle = Theme.colors.textMid;
        ctx.font = `400 12px ${Theme.fonts.sans}`;
        ctx.fillText(
          `${rec.reason} · 关联度 ${(rec.score * 100).toFixed(0)}%`,
          cardX + 24,
          cardY + 30,
        );

        // Animated Resonance Meter Bar
        const meterW = 56;
        const meterH = 6;
        const meterX = cardX + cardW - meterW - 14;
        const meterY = cardY + 28;

        ctx.fillStyle = 'rgba(243, 196, 118, 0.15)';
        ctx.beginPath();
        ctx.roundRect(meterX, meterY, meterW, meterH, 3);
        ctx.fill();

        ctx.fillStyle = Theme.colors.borderActive;
        ctx.beginPath();
        ctx.roundRect(meterX, meterY, meterW * Math.min(1, Math.max(0.2, rec.score)), meterH, 3);
        ctx.fill();

        curY += cardH + 10;
      }
    }

    this.maxScrollY = Math.max(0, curY + this.scrollY - startY - drawerHeight + 40);

    ctx.restore();

    // Sticky close button drawn on top of scrolled content
    ctx.fillStyle = this.copyState === 'success' ? 'rgba(70, 130, 90, 0.35)' : Theme.colors.bgCard;
    ctx.beginPath();
    ctx.roundRect(
      this.copyBtnRect.x,
      this.copyBtnRect.y,
      this.copyBtnRect.w,
      this.copyBtnRect.h,
      6,
    );
    ctx.fill();
    ctx.strokeStyle = this.copyState === 'error' ? '#c66' : Theme.colors.border;
    ctx.stroke();
    ctx.fillStyle = this.copyState === 'error' ? '#e88' : Theme.colors.textHigh;
    ctx.font = `600 12px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      this.copyState === 'success' ? '✓' : this.copyState === 'error' ? '!' : '⧉',
      this.copyBtnRect.x + 16,
      this.copyBtnRect.y + 16,
    );

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
    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `600 16px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✕', this.closeBtnRect.x + 16, this.closeBtnRect.y + 16);
  }

  public handleClick(clientX: number, clientY: number): boolean {
    if (!this.isOpen || !this.details) return false;

    // Check Close button
    if (this.isInRect(clientX, clientY, this.closeBtnRect)) {
      this.close();
      return true;
    }

    if (this.isInRect(clientX, clientY, this.copyBtnRect)) {
      void this.copyDetailsText();
      return true;
    }

    // Check Pathfinder button
    if (this.isInRect(clientX, clientY, this.pathfinderBtnRect)) {
      const labels = this.details.entity.names?.labels || {};
      const name = labels.zh || labels['zh-cn'] || labels.en || this.details.entity.id;
      this.onStartPathfinderCb(this.details.entity.id, name);
      return true;
    }

    // Check Expand button
    if (this.isInRect(clientX, clientY, this.expandBtnRect)) {
      this.onExpandNodeCb(this.details.entity.id);
      return true;
    }

    // Check Recommendation cards
    for (const rect of this.recItemRects) {
      if (this.isInRect(clientX, clientY, rect)) {
        this.onSelectEntityCb(rect.id);
        return true;
      }
    }
    return false;
  }

  private isInRect(
    x: number,
    y: number,
    r: { x: number; y: number; w: number; h: number },
  ): boolean {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  private formatYear(iso?: string | null): string {
    if (!iso) return '';
    const match = iso.match(/([+-]?\d{1,4})/);
    return match ? match[1]!.replace('+', '') : iso;
  }

  private async copyDetailsText(): Promise<void> {
    if (!this.details || !navigator.clipboard) {
      this.copyState = 'error';
      this.scene.markDirty();
      return;
    }
    try {
      await navigator.clipboard.writeText(formatEntityDetailsText(this.details));
      this.copyState = 'success';
    } catch {
      this.copyState = 'error';
    }
    this.scene.markDirty();
    window.setTimeout(() => {
      if (this.isOpen) {
        this.copyState = 'idle';
        this.scene.markDirty();
      }
    }, 1500);
  }

  private formatCountry(c?: string | null): string {
    if (!c) return '';
    const map: Record<string, string> = {
      Q17: '日本',
      Q145: '英国',
      Q30: '美国',
      Q142: '法国',
      Q183: '德国',
      Q148: '中国',
      Q38: '意大利',
      Q29: '西班牙',
      Q159: '俄罗斯',
      Q33: '芬兰',
      Q34: '瑞典',
      Q20: '挪威',
      Q40: '奥地利',
      Q39: '瑞士',
      Q55: '荷兰',
      Q31: '比利时',
      Q16: '加拿大',
      Q408: '澳大利亚',
    };
    return map[c] || c;
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
