import { Entity } from '@vectojs/core';
import type { GraphViewport } from '../scene/GraphViewport';
import { getCanvasCtx, Theme } from './theme';

export class ViewportControls extends Entity {
  private viewport: GraphViewport;

  private fitBtnRect = { x: 0, y: 0, w: 36, h: 36 };
  private freezeBtnRect = { x: 0, y: 0, w: 36, h: 36 };
  private resetBtnRect = { x: 0, y: 0, w: 36, h: 36 };

  constructor(viewport: GraphViewport) {
    super();
    this.id = 'viewport-controls';
    this.interactive = true;
    this.viewport = viewport;
  }

  isPointInside(x: number, y: number): boolean {
    const endX = this.scene ? this.scene.width - 24 : 0;
    const startY = this.scene ? this.scene.height - 60 : 0;
    return x >= endX - 130 && x <= endX && y >= startY && y <= startY + 40;
  }

  render(r: any): void {
    const ctx = getCanvasCtx(r);
    const endX = this.scene.width - 24;
    const startY = this.scene.height - 60;

    this.resetBtnRect = { x: endX - 36, y: startY, w: 36, h: 36 };
    this.freezeBtnRect = { x: endX - 80, y: startY, w: 36, h: 36 };
    this.fitBtnRect = { x: endX - 124, y: startY, w: 36, h: 36 };

    // 1. Fit to View Button
    this.drawButton(ctx, this.fitBtnRect, '⌖', '视口居中');

    // 2. Freeze Physics Button
    const isFrozen = this.viewport.isPhysicsFrozen();
    this.drawButton(ctx, this.freezeBtnRect, isFrozen ? '🔥' : '🧊', isFrozen ? '解冻' : '冻结');

    // 3. Reset Zoom Button
    this.drawButton(ctx, this.resetBtnRect, '🔄', '重置');
  }

  private drawButton(
    ctx: CanvasRenderingContext2D,
    rect: { x: number; y: number; w: number; h: number },
    icon: string,
    _tooltip: string,
  ): void {
    ctx.save();
    ctx.fillStyle = 'rgba(30, 26, 23, 0.9)';
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 6);
    ctx.fill();

    ctx.strokeStyle = Theme.colors.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = Theme.colors.textMid;
    ctx.font = `600 15px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.restore();
  }

  public handleClick(clientX: number, clientY: number): boolean {
    if (this.isInRect(clientX, clientY, this.fitBtnRect)) {
      this.viewport.fitToView();
      return true;
    }

    if (this.isInRect(clientX, clientY, this.freezeBtnRect)) {
      this.viewport.freeze(!this.viewport.isPhysicsFrozen());
      return true;
    }

    if (this.isInRect(clientX, clientY, this.resetBtnRect)) {
      this.viewport.resetZoom();
      return true;
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
}
