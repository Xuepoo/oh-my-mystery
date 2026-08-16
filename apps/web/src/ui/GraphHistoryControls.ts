import { Entity } from '@vectojs/core';
import { getCanvasCtx, Theme } from './theme';

export class GraphHistoryControls extends Entity {
  private count = 0;
  private buttonRect = { x: 128, y: 76, w: 80, h: 44 };
  private readonly onUndoCb: () => void;

  constructor(onUndo: () => void) {
    super();
    this.id = 'graph-history-controls';
    this.interactive = true;
    this.onUndoCb = onUndo;
  }

  setCount(count: number): void {
    if (this.count === count) return;
    this.count = count;
    this.scene?.markDirty();
  }

  isPointInside(x: number, y: number): boolean {
    return this.count > 0 && this.inRect(x, y, this.buttonRect);
  }

  handleClick(x: number, y: number): boolean {
    if (!this.isPointInside(x, y)) return false;
    this.onUndoCb();
    return true;
  }

  render(r: any): void {
    if (this.count <= 0) return;
    const ctx = getCanvasCtx(r);
    this.buttonRect = { x: 128, y: 76, w: 80, h: 44 };
    ctx.fillStyle = 'rgba(30, 24, 19, 0.94)';
    ctx.beginPath();
    ctx.roundRect(this.buttonRect.x, this.buttonRect.y, this.buttonRect.w, this.buttonRect.h, 8);
    ctx.fill();
    ctx.strokeStyle = Theme.colors.border;
    ctx.stroke();
    ctx.fillStyle = Theme.colors.textMid;
    ctx.font = `600 11px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`↶ 返回 ${this.count}`, this.buttonRect.x + 40, this.buttonRect.y + 22);
  }

  private inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }
}
