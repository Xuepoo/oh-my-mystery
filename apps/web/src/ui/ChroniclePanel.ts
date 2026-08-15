import { Entity } from '@vectojs/core';
import type { ChronicleStep, ChronicleTrail } from '@omm/shared';
import { getCanvasCtx, getEventCoords, Theme } from './theme';

export interface ChroniclePanelOptions {
  onClose: () => void;
  onStepChange: (step: ChronicleStep) => void;
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

    this.on('pointerdown', (e: any) => {
      if (!this.isOpen) return;
      const { x, y } = getEventCoords(e);
      this.handleClick(x, y);
    });
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

  private notifyStep(): void {
    const currentTrail = this.trails[this.currentTrailIndex];
    if (currentTrail && currentTrail.steps[this.currentStepIndex]) {
      this.onStepChangeCb(currentTrail.steps[this.currentStepIndex]!);
    }
  }

  render(r: any): void {
    if (!this.isOpen || this.trails.length === 0) return;

    const ctx = getCanvasCtx(r);
    const modalWidth = Math.min(560, this.scene.width * 0.9);
    const modalHeight = Math.min(460, this.scene.height * 0.85);
    const modalX = (this.scene.width - modalWidth) / 2;
    const modalY = (this.scene.height - modalHeight) / 2;

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
    let tabX = modalX + 24;
    const tabY = modalY + 58;
    this.trailTabRects = [];

    for (let i = 0; i < this.trails.length; i++) {
      const trail = this.trails[i]!;
      const isSelected = i === this.currentTrailIndex;
      const tabW = 220;
      const tabH = 32;

      this.trailTabRects.push({ index: i, x: tabX, y: tabY, w: tabW, h: tabH });

      ctx.fillStyle = isSelected ? Theme.colors.bgCardHover : Theme.colors.bgCard;
      ctx.beginPath();
      ctx.roundRect(tabX, tabY, tabW, tabH, 6);
      ctx.fill();
      ctx.strokeStyle = isSelected ? Theme.colors.borderHighlight : Theme.colors.border;
      ctx.stroke();

      ctx.fillStyle = isSelected ? Theme.colors.borderHighlight : Theme.colors.textMid;
      ctx.font = `600 12px ${Theme.fonts.sans}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(trail.title.zh || trail.title.en, tabX + tabW / 2, tabY + tabH / 2);

      tabX += tabW + 12;
    }

    // Current Trail Details
    const trail = this.trails[this.currentTrailIndex]!;
    let curY = modalY + 104;

    // Trail Intro
    ctx.fillStyle = Theme.colors.textMid;
    ctx.font = `400 13px ${Theme.fonts.serif}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const introLines = this.wrapText(
      ctx,
      trail.description.zh || trail.description.en,
      modalWidth - 48,
    );
    for (const l of introLines.slice(0, 2)) {
      ctx.fillText(l, modalX + 24, curY);
      curY += 18;
    }
    curY += 12;

    // Step Progress Dots
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
    curY += 28;

    // Current Step Highlight Card (Illuminated Manuscript Style)
    const step = trail.steps[this.currentStepIndex]!;
    const cardW = modalWidth - 48;
    const cardH = 160;
    const cardX = modalX + 24;
    const cardY = curY;

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
    ctx.roundRect(cardX + 16, cardY + 16, 92, 22, 4);
    ctx.fill();

    ctx.fillStyle = '#1A1715';
    ctx.font = `700 11px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`第 ${this.currentStepIndex + 1} 幕 · ${step.year || ''}`, cardX + 62, cardY + 27);

    // Step Title
    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `700 16px ${Theme.fonts.serif}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(step.title.zh || step.title.en, cardX + 120, cardY + 27);

    // Step Summary
    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `400 13px ${Theme.fonts.serif}`;
    const stepLines = this.wrapText(ctx, step.summary.zh || step.summary.en, cardW - 32);
    let stepY = cardY + 54;
    for (const l of stepLines.slice(0, 4)) {
      ctx.fillText(l, cardX + 16, stepY);
      stepY += 20;
    }

    // Step Action Notice
    ctx.fillStyle = Theme.colors.borderHighlight;
    ctx.font = `500 11px ${Theme.fonts.sans}`;
    ctx.fillText('💡 图谱镜头已自动聚焦至该时期核心线索', cardX + 16, cardY + cardH - 22);

    // Bottom Navigation Buttons [Prev Step] [Next Step]
    const navY = modalY + modalHeight - 56;
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
