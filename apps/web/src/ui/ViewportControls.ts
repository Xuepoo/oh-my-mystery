import { Entity } from '@vectojs/core';
import type { GraphViewport } from '../scene/GraphViewport';
import { getCanvasCtx, Theme } from './theme';

export class ViewportControls extends Entity {
  private viewport: GraphViewport;

  private fitBtnRect = { x: -100, y: -100, w: 36, h: 36 };
  private freezeBtnRect = { x: -100, y: -100, w: 36, h: 36 };
  private resetBtnRect = { x: -100, y: -100, w: 36, h: 36 };
  private rendered = false;
  private visible = true;

  constructor(viewport: GraphViewport) {
    super();
    this.id = 'viewport-controls';
    this.interactive = true;
    this.viewport = viewport;
  }

  isPointInside(x: number, y: number): boolean {
    if (!this.rendered || !this.visible) return false;
    const endX = this.scene ? this.scene.width - 24 : 0;
    const startY = this.scene ? this.scene.height - 60 : 0;
    // Button area only (no dead sliver left of the fit button)
    return x >= endX - 128 && x <= endX && y >= startY && y <= startY + 40;
  }

  render(r: any): void {
    if (!this.visible) return;
    const ctx = getCanvasCtx(r);
    const endX = this.scene.width - 24;
    const startY = this.scene.height - 60;

    this.resetBtnRect = { x: endX - 36, y: startY, w: 36, h: 36 };
    this.freezeBtnRect = { x: endX - 80, y: startY, w: 36, h: 36 };
    this.fitBtnRect = { x: endX - 124, y: startY, w: 36, h: 36 };

    // 1. Fit to View Button
    this.drawButton(ctx, this.fitBtnRect, '⌖');

    // 2. Freeze Physics Button
    const isFrozen = this.viewport.isPhysicsFrozen();
    this.drawButton(ctx, this.freezeBtnRect, isFrozen ? '🔥' : '🧊');

    // 3. Reset Zoom Button (fits the graph back into view)
    this.drawButton(ctx, this.resetBtnRect, '🔄');
    this.rendered = true;
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.scene?.markDirty();
  }

  private drawButton(
    ctx: CanvasRenderingContext2D,
    rect: { x: number; y: number; w: number; h: number },
    icon: string,
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
