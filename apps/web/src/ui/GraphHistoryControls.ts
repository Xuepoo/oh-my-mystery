import { Entity } from '@vectojs/core';
import { getCanvasCtx, Theme } from './theme';

export class GraphHistoryControls extends Entity {
  private count = 0;
  private buttonRect = { x: 16, y: 232, w: 96, h: 44 };
  private readonly onUndoCb: () => void;
  private enabled = true;

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

  getInstrumentationState(): { count: number } {
    return { count: this.count };
  }

  getInstrumentationTargets(): readonly {
    id: 'tool.history.undo';
    rect: { x: number; y: number; w: number; h: number };
  }[] {
    return this.enabled && this.count > 0
      ? [{ id: 'tool.history.undo', rect: { ...this.buttonRect } }]
      : [];
  }

  isPointInside(x: number, y: number): boolean {
    return this.enabled && this.count > 0 && this.inRect(x, y, this.buttonRect);
  }

  handleClick(x: number, y: number): boolean {
    if (!this.isPointInside(x, y)) return false;
    this.onUndoCb();
    return true;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.scene?.markDirty();
  }

  render(r: any): void {
    if (!this.enabled || this.count <= 0) return;
    const ctx = getCanvasCtx(r);
    this.buttonRect = { x: 16, y: 232, w: 96, h: 44 };
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
    ctx.fillText(`↶ 返回 ${this.count}`, this.buttonRect.x + 48, this.buttonRect.y + 22);
  }

  private inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }
}
