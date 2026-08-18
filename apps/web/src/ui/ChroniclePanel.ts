import { Entity, type A11yAttributes } from '@vectojs/core';
import type { ChronicleStep, ChronicleTrail } from '@omm/shared';
import { getCanvasCtx, Theme } from './theme';
import { truncateText, wrapText, withClip } from './text-layout';

export interface ChroniclePanelOptions {
  onClose: () => void;
  onStepChange: (step: ChronicleStep) => void;
}

export function getChronicleLayout(
  width: number,
  height: number,
  trailCount = 6,
): {
  modal: { x: number; y: number; w: number; h: number };
  columns: number;
  tabs: { x: number; y: number; w: number; h: number; itemH: number; gap: number };
  intro: { x: number; y: number; w: number; h: number } | null;
  progress: { x: number; y: number; w: number; h: number } | null;
  card: { x: number; y: number; w: number; h: number };
  nav: { x: number; y: number; w: number; h: number };
} {
  const modalW = Math.max(0, Math.min(560, width - 24));
  const modalH = Math.max(0, Math.min(520, height - 24));
  const columns = modalW < 420 ? 2 : 3;
  const modal = { x: (width - modalW) / 2, y: (height - modalH) / 2, w: modalW, h: modalH };
  const compact = modalH < 400;
  const tabH = compact ? 24 : 32;
  const tabGap = compact ? 4 : 8;
  const tabRows = Math.max(1, Math.ceil(trailCount / columns));
  const tabs = {
    x: modal.x + 24,
    y: modal.y + 58,
    w: Math.max(0, modal.w - 48),
    h: tabRows * tabH + (tabRows - 1) * tabGap,
    itemH: tabH,
    gap: tabGap,
  };
  const nav = {
    x: modal.x + 24,
    y: modal.y + modal.h - 56,
    w: Math.max(0, modal.w - 48),
    h: 36,
  };
  let bodyY = tabs.y + tabs.h + (compact ? 8 : 12);
  let available = Math.max(0, nav.y - 12 - bodyY);
  const intro = available >= 170 ? { x: tabs.x, y: bodyY, w: tabs.w, h: 48 } : null;
  if (intro) {
    bodyY += intro.h;
    available -= intro.h;
  }
  const progress = available >= 110 ? { x: tabs.x, y: bodyY, w: tabs.w, h: 28 } : null;
  if (progress) bodyY += progress.h;
  const card = {
    x: tabs.x,
    y: bodyY,
    w: tabs.w,
    h: Math.max(0, Math.min(160, nav.y - 12 - bodyY)),
  };
  return {
    modal,
    columns,
    tabs,
    intro,
    progress,
    card,
    nav,
  };
}

export class ChroniclePanel extends Entity {
  private trails: ChronicleTrail[] = [];
  private currentTrailIndex = 0;
  private currentStepIndex = 0;
  private isOpen = false;
  private onCloseCb: () => void;
  private onStepChangeCb: (step: ChronicleStep) => void;

  private closeBtnRect = { x: 0, y: 0, w: 32, h: 32 };
  private prevBtnRect = { x: 0, y: 0, w: 100, h: 36 };
  private nextBtnRect = { x: 0, y: 0, w: 100, h: 36 };
  private trailTabRects: { index: number; x: number; y: number; w: number; h: number }[] = [];

  constructor(options: ChroniclePanelOptions) {
    super();
    this.id = 'chronicle-panel';
    this.interactive = true;
    this.onCloseCb = options.onClose;
    this.onStepChangeCb = options.onStepChange;
  }

  isPointInside(_x: number, _y: number): boolean {
    return this.isOpen;
  }

  open(trails: ChronicleTrail[]): void {
    this.trails = trails;
    this.isOpen = true;
    this.currentTrailIndex = 0;
    this.currentStepIndex = 0;
    this.notifyStep();
    this.scene.markDirty();
  }

  close(): void {
    this.isOpen = false;
    this.onCloseCb();
    this.scene.markDirty();
  }

  isPanelOpen(): boolean {
    return this.isOpen;
  }

  isModalOpen(): boolean {
    return this.isOpen;
  }

  getA11yAttributes(): A11yAttributes {
    return { role: 'dialog', label: '推理演进编年史', ariaModal: 'true' };
  }

  getLayout(): ReturnType<typeof getChronicleLayout> {
    return getChronicleLayout(
      this.scene?.width ?? 0,
      this.scene?.height ?? 0,
      Math.max(1, this.trails.length),
    );
  }

  private notifyStep(): void {
    this.scene?.markDirty();
    const currentTrail = this.trails[this.currentTrailIndex];
    if (currentTrail && currentTrail.steps[this.currentStepIndex]) {
      this.onStepChangeCb(currentTrail.steps[this.currentStepIndex]!);
    }
  }

  render(r: any): void {
    if (!this.isOpen || this.trails.length === 0) return;

    const ctx = getCanvasCtx(r);
    const layout = this.getLayout();
    const { x: modalX, y: modalY, w: modalWidth, h: modalHeight } = layout.modal;

    // Dim Background Overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, this.scene.width, this.scene.height);

    // Modal Background
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 30;
    ctx.fillStyle = Theme.colors.bgParchmentDark;
    ctx.beginPath();
    ctx.roundRect(modalX, modalY, modalWidth, modalHeight, 12);
    ctx.fill();
    ctx.restore();

    // Border
    ctx.strokeStyle = Theme.colors.borderHighlight;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Header Title
    ctx.fillStyle = Theme.colors.borderHighlight;
    ctx.font = `700 18px ${Theme.fonts.serif}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('📜 推理演进编年史 (Chronicle Trails)', modalX + 24, modalY + 22);

    // Close Button
    this.closeBtnRect = { x: modalX + modalWidth - 48, y: modalY + 16, w: 32, h: 32 };
    ctx.fillStyle = Theme.colors.bgCard;
    ctx.beginPath();
    ctx.roundRect(this.closeBtnRect.x, this.closeBtnRect.y, 32, 32, 6);
    ctx.fill();
    ctx.strokeStyle = Theme.colors.border;
    ctx.stroke();

    ctx.fillStyle = Theme.colors.textMid;
    ctx.font = `600 15px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✕', this.closeBtnRect.x + 16, this.closeBtnRect.y + 16);

    // Trail Tabs
    const tabY = layout.tabs.y;
    this.trailTabRects = [];
    const tabColumns = layout.columns;
    const tabGap = layout.tabs.gap;
    const tabW = (modalWidth - 48 - tabGap * (tabColumns - 1)) / tabColumns;
    const tabH = layout.tabs.itemH;
    for (let i = 0; i < this.trails.length; i++) {
      const trail = this.trails[i]!;
      const isSelected = i === this.currentTrailIndex;
      const col = i % tabColumns;
      const row = Math.floor(i / tabColumns);
      const tabX = modalX + 24 + col * (tabW + tabGap);
      const currentTabY = tabY + row * (tabH + tabGap);

      this.trailTabRects.push({ index: i, x: tabX, y: currentTabY, w: tabW, h: tabH });

      ctx.fillStyle = isSelected ? Theme.colors.bgCardHover : Theme.colors.bgCard;
      ctx.beginPath();
      ctx.roundRect(tabX, currentTabY, tabW, tabH, 6);
      ctx.fill();
      ctx.strokeStyle = isSelected ? Theme.colors.borderHighlight : Theme.colors.border;
      ctx.stroke();

      ctx.fillStyle = isSelected ? Theme.colors.borderHighlight : Theme.colors.textMid;
      ctx.font = `600 12px ${Theme.fonts.sans}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tabLabel = trail.title.zh || trail.title.en || trail.slug;
      ctx.fillText(truncateText(ctx, tabLabel, tabW - 16), tabX + tabW / 2, currentTabY + tabH / 2);
    }

    // Current Trail Details
    const trail = this.trails[this.currentTrailIndex]!;
    let curY = layout.intro?.y ?? layout.progress?.y ?? layout.card.y;

    // Trail Intro
    if (layout.intro) {
      ctx.fillStyle = Theme.colors.textMid;
      ctx.font = `400 13px ${Theme.fonts.serif}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const introLines = wrapText(
        ctx,
        trail.description.zh || trail.description.en || '',
        modalWidth - 48,
      );
      for (const l of introLines.slice(0, 2)) {
        ctx.fillText(l, modalX + 24, curY);
        curY += 18;
      }
      curY = layout.progress?.y ?? layout.card.y;
    }

    // Step Progress Dots
    if (layout.progress) {
      const dotStartX = modalX + 24;
      const dotSpacing = (modalWidth - 48) / Math.max(1, trail.steps.length - 1);
      ctx.strokeStyle = Theme.colors.border;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(dotStartX, curY + 6);
      ctx.lineTo(modalX + modalWidth - 24, curY + 6);
      ctx.stroke();

      for (let s = 0; s < trail.steps.length; s++) {
        const dx = dotStartX + s * dotSpacing;
        const dy = curY + 6;
        const isPast = s <= this.currentStepIndex;
        const isCurrent = s === this.currentStepIndex;

        if (isCurrent) {
          ctx.save();
          ctx.shadowColor = Theme.colors.borderActive;
          ctx.shadowBlur = 12;
          ctx.fillStyle = Theme.colors.borderActive;
          ctx.beginPath();
          ctx.arc(dx, dy, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else {
          ctx.fillStyle = isPast ? Theme.colors.author : Theme.colors.bgCard;
          ctx.beginPath();
          ctx.arc(dx, dy, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = Theme.colors.border;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }
      curY = layout.card.y;
    }

    // Current Step Highlight Card (Illuminated Manuscript Style)
    const step = trail.steps[Math.min(this.currentStepIndex, Math.max(0, trail.steps.length - 1))];
    const { x: cardX, y: cardY, w: cardW, h: cardH } = layout.card;

    if (!step) {
      ctx.fillStyle = Theme.colors.textMid;
      ctx.font = `400 13px ${Theme.fonts.serif}`;
      ctx.fillText('这条时间线暂时没有节点数据。', cardX, cardY + 20);
      return;
    }

    ctx.save();
    ctx.fillStyle = Theme.colors.bgCard;
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 8);
    ctx.fill();
    ctx.strokeStyle = Theme.colors.borderHighlight;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // Gold Corner Brackets on Card
    ctx.strokeStyle = Theme.colors.borderActive;
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Top-Left corner
    ctx.moveTo(cardX, cardY + 12);
    ctx.lineTo(cardX, cardY);
    ctx.lineTo(cardX + 12, cardY);
    // Top-Right corner
    ctx.moveTo(cardX + cardW - 12, cardY);
    ctx.lineTo(cardX + cardW, cardY);
    ctx.lineTo(cardX + cardW, cardY + 12);
    // Bottom-Left corner
    ctx.moveTo(cardX, cardY + cardH - 12);
    ctx.lineTo(cardX, cardY + cardH);
    ctx.lineTo(cardX + 12, cardY + cardH);
    // Bottom-Right corner
    ctx.moveTo(cardX + cardW - 12, cardY + cardH);
    ctx.lineTo(cardX + cardW, cardY + cardH);
    ctx.lineTo(cardX + cardW, cardY + cardH - 12);
    ctx.stroke();
    ctx.restore();

    // Chapter Pill
    ctx.fillStyle = Theme.colors.borderHighlight;
    ctx.beginPath();
    const titleY = cardH < 90 ? cardY + 12 : cardY + 18;
    ctx.roundRect(cardX + 16, cardY + (cardH < 90 ? 8 : 16), 92, 22, 4);
    ctx.fill();

    ctx.fillStyle = '#1A1715';
    ctx.font = `700 11px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(
      `第 ${this.currentStepIndex + 1} 幕 · ${step.year || ''}`,
      cardX + 62,
      cardY + (cardH < 90 ? 12 : 20),
    );

    // Step Title
    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `700 16px ${Theme.fonts.serif}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(
      truncateText(ctx, step.title.zh || step.title.en || '', Math.max(0, cardW - 144)),
      cardX + 120,
      titleY,
    );

    // Step Summary
    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `400 13px ${Theme.fonts.serif}`;
    const stepLines = wrapText(ctx, step.summary.zh || step.summary.en || '', cardW - 32, 4);
    let stepY = cardY + 52;
    if (cardH >= 90) {
      withClip(ctx, { x: cardX + 12, y: cardY + 48, w: cardW - 24, h: cardH - 62 }, () => {
        for (const l of stepLines) {
          ctx.fillText(l, cardX + 16, stepY);
          stepY += 20;
        }
      });
    }

    // Step Action Notice
    ctx.fillStyle = Theme.colors.borderHighlight;
    ctx.font = `500 11px ${Theme.fonts.sans}`;
    if (cardH >= 120) {
      ctx.fillText('💡 图谱镜头已聚焦该时期核心线索', cardX + 16, cardY + cardH - 22);
    }

    // Bottom Navigation Buttons [Prev Step] [Next Step]
    const navY = layout.nav.y;
    this.prevBtnRect = { x: modalX + 24, y: navY, w: 120, h: 36 };
    this.nextBtnRect = { x: modalX + modalWidth - 144, y: navY, w: 120, h: 36 };

    // Prev Btn
    const canPrev = this.currentStepIndex > 0;
    ctx.fillStyle = canPrev ? Theme.colors.bgCard : 'rgba(30, 26, 23, 0.4)';
    ctx.beginPath();
    ctx.roundRect(
      this.prevBtnRect.x,
      this.prevBtnRect.y,
      this.prevBtnRect.w,
      this.prevBtnRect.h,
      6,
    );
    ctx.fill();
    ctx.strokeStyle = canPrev ? Theme.colors.border : 'transparent';
    ctx.stroke();

    ctx.fillStyle = canPrev ? Theme.colors.textHigh : Theme.colors.textMuted;
    ctx.font = `600 13px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('◀ 上一章节', this.prevBtnRect.x + 60, this.prevBtnRect.y + 18);

    // Next Btn
    const canNext = this.currentStepIndex < trail.steps.length - 1;
    ctx.fillStyle = canNext ? Theme.colors.borderHighlight : Theme.colors.bgCard;
    ctx.beginPath();
    ctx.roundRect(
      this.nextBtnRect.x,
      this.nextBtnRect.y,
      this.nextBtnRect.w,
      this.nextBtnRect.h,
      6,
    );
    ctx.fill();

    ctx.fillStyle = canNext ? '#1A1715' : Theme.colors.textMuted;
    ctx.fillText(
      canNext ? '下一章节 ▶' : '已完结 ✓',
      this.nextBtnRect.x + 60,
      this.nextBtnRect.y + 18,
    );
  }

  public handleClick(clientX: number, clientY: number): boolean {
    if (!this.isOpen) return false;

    if (this.isInRect(clientX, clientY, this.closeBtnRect)) {
      this.close();
      return true;
    }

    // Tabs
    for (const tab of this.trailTabRects) {
      if (this.isInRect(clientX, clientY, tab)) {
        this.currentTrailIndex = tab.index;
        this.currentStepIndex = 0;
        this.notifyStep();
        return true;
      }
    }

    // Prev
    if (this.isInRect(clientX, clientY, this.prevBtnRect) && this.currentStepIndex > 0) {
      this.currentStepIndex--;
      this.notifyStep();
      return true;
    }

    // Next
    const trail = this.trails[this.currentTrailIndex];
    if (
      trail &&
      this.isInRect(clientX, clientY, this.nextBtnRect) &&
      this.currentStepIndex < trail.steps.length - 1
    ) {
      this.currentStepIndex++;
      this.notifyStep();
      return true;
    }

    return true; // Click was absorbed inside open modal
  }

  private isInRect(
    x: number,
    y: number,
    r: { x: number; y: number; w: number; h: number },
  ): boolean {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }
}
