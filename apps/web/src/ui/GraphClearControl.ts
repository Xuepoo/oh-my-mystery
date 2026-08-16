import { Entity } from '@vectojs/core';
import { getCanvasCtx, Theme } from './theme';

export class GraphClearControl extends Entity {
  private enabled = true;
  private armedUntil = 0;
  private rect = { x: 16, y: 180, w: 96, h: 44 };
  private readonly onClear: () => void;

  constructor(onClear: () => void) {
    super();
    this.id = 'graph-clear-control';
    this.interactive = true;
    this.onClear = onClear;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.armedUntil = 0;
    this.scene?.markDirty();
  }

  isPointInside(x: number, y: number): boolean {
    return (
      this.enabled &&
      x >= this.rect.x &&
      x <= this.rect.x + this.rect.w &&
      y >= this.rect.y &&
      y <= this.rect.y + this.rect.h
    );
  }

  handleClick(x: number, y: number): boolean {
    if (!this.isPointInside(x, y)) return false;
    const now = performance.now();
    if (now <= this.armedUntil) {
      this.armedUntil = 0;
      this.onClear();
    } else {
      this.armedUntil = now + 3000;
      this.scene.markDirty();
      setTimeout(() => this.scene?.markDirty(), 3050);
    }
    return true;
  }

  render(r: any): void {
    if (!this.enabled) return;
    const ctx = getCanvasCtx(r);
    const armed = performance.now() <= this.armedUntil;
    ctx.fillStyle = armed ? '#B8323C' : 'rgba(30, 24, 19, 0.94)';
    ctx.beginPath();
    ctx.roundRect(this.rect.x, this.rect.y, this.rect.w, this.rect.h, 8);
    ctx.fill();
    ctx.strokeStyle = armed ? '#FFD0D4' : Theme.colors.border;
    ctx.stroke();
    ctx.fillStyle = armed ? '#FFFDF9' : Theme.colors.textMid;
    ctx.font = `600 11px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      armed ? '再次点击确认' : '清空画布',
      this.rect.x + this.rect.w / 2,
      this.rect.y + this.rect.h / 2,
    );
  }
}
