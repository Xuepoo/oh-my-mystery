import { Entity } from '@vectojs/core';
import type { GraphViewport } from '../scene/GraphViewport';
import type { GraphNode2D } from '../scene/types';
import { getCanvasCtx, Theme } from './theme';

interface RowRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class VisibilityManager extends Entity {
  private readonly viewport: GraphViewport;
  private open = false;
  private page = 0;
  private toggleRect = { x: 16, y: 284, w: 96, h: 44 };
  private modalRect = { x: 0, y: 0, w: 0, h: 0 };
  private closeRect = { x: 0, y: 0, w: 44, h: 44 };
  private restoreAllRect = { x: 0, y: 0, w: 120, h: 44 };
  private prevRect = { x: 0, y: 0, w: 80, h: 44 };
  private nextRect = { x: 0, y: 0, w: 80, h: 44 };
  private rowRects: RowRect[] = [];
  private enabled = true;

  constructor(viewport: GraphViewport) {
    super();
    this.id = 'visibility-manager';
    this.interactive = true;
    this.viewport = viewport;
  }

  isPanelOpen(): boolean {
    return this.open;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.scene?.markDirty();
  }

  isPointInside(x: number, y: number): boolean {
    if (!this.enabled) return false;
    if (this.open) return true;
    return this.viewport.getHiddenNodes().length > 0 && this.inRect(x, y, this.toggleRect);
  }

  handleClick(x: number, y: number): boolean {
    if (!this.enabled) return false;
    const hidden = this.viewport.getHiddenNodes();
    if (!this.open) {
      if (!hidden.length || !this.inRect(x, y, this.toggleRect)) return false;
      this.open = true;
      this.page = 0;
      this.scene.markDirty();
      return true;
    }

    if (this.inRect(x, y, this.closeRect) || !this.inRect(x, y, this.modalRect)) {
      this.close();
      return true;
    }
    if (this.inRect(x, y, this.restoreAllRect)) {
      this.viewport.restoreAllHidden();
      this.close();
      return true;
    }
    for (const row of this.rowRects) {
      if (!this.inRect(x, y, row)) continue;
      this.viewport.restoreNode(row.id);
      if (!this.viewport.getHiddenNodes().length) this.close();
      else this.scene.markDirty();
      return true;
    }
    const pageCount = this.getPageCount(hidden.length);
    if (this.inRect(x, y, this.prevRect) && this.page > 0) {
      this.page--;
      this.scene.markDirty();
      return true;
    }
    if (this.inRect(x, y, this.nextRect) && this.page < pageCount - 1) {
      this.page++;
      this.scene.markDirty();
      return true;
    }
    return true;
  }

  render(r: any): void {
    if (!this.enabled) return;
    const hidden = this.viewport.getHiddenNodes();
    if (!hidden.length) {
      this.open = false;
      return;
    }
    const ctx = getCanvasCtx(r);
    this.toggleRect = { x: 16, y: 284, w: 96, h: 44 };
    this.drawButton(ctx, this.toggleRect, `隐藏 ${hidden.length}`, false);
    if (!this.open) return;

    ctx.fillStyle = 'rgba(8, 6, 5, 0.72)';
    ctx.fillRect(0, 0, this.scene.width, this.scene.height);
    const modalW = Math.min(440, this.scene.width - 32);
    const modalH = Math.min(520, this.scene.height - 40);
    const modalX = (this.scene.width - modalW) / 2;
    const modalY = (this.scene.height - modalH) / 2;
    this.modalRect = { x: modalX, y: modalY, w: modalW, h: modalH };
    ctx.fillStyle = 'rgba(28, 21, 16, 0.98)';
    ctx.beginPath();
    ctx.roundRect(modalX, modalY, modalW, modalH, 12);
    ctx.fill();
    ctx.strokeStyle = Theme.colors.borderHighlight;
    ctx.stroke();

    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `700 18px ${Theme.fonts.serif}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`可见性管理 · ${hidden.length} 个隐藏节点`, modalX + 20, modalY + 30);
    this.closeRect = { x: modalX + modalW - 52, y: modalY + 8, w: 44, h: 44 };
    this.drawButton(ctx, this.closeRect, '×', false);

    const pageSize = this.getPageSize(modalH);
    const pageCount = Math.max(1, Math.ceil(hidden.length / pageSize));
    this.page = Math.min(this.page, pageCount - 1);
    const visible = hidden.slice(this.page * pageSize, (this.page + 1) * pageSize);
    this.rowRects = [];
    for (let i = 0; i < visible.length; i++) {
      const node = visible[i]!;
      const rect = { id: node.id, x: modalX + 16, y: modalY + 62 + i * 48, w: modalW - 32, h: 44 };
      this.rowRects.push(rect);
      this.drawRow(ctx, rect, node);
    }

    const footerY = modalY + modalH - 56;
    this.restoreAllRect = { x: modalX + 16, y: footerY, w: 120, h: 44 };
    this.drawButton(ctx, this.restoreAllRect, '全部恢复', true);
    this.prevRect = { x: modalX + modalW - 184, y: footerY, w: 80, h: 44 };
    this.nextRect = { x: modalX + modalW - 96, y: footerY, w: 80, h: 44 };
    this.drawButton(ctx, this.prevRect, '上一页', this.page > 0);
    this.drawButton(ctx, this.nextRect, '下一页', this.page < pageCount - 1);
    ctx.fillStyle = Theme.colors.textMuted;
    ctx.font = `500 10px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.fillText(`${this.page + 1} / ${pageCount}`, modalX + modalW - 140, footerY - 7);
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.close();
    this.scene?.markDirty();
  }

  private getPageSize(modalH: number): number {
    return Math.max(1, Math.floor((modalH - 130) / 48));
  }

  private getPageCount(count: number): number {
    const modalH = Math.min(520, this.scene.height - 40);
    return Math.max(1, Math.ceil(count / this.getPageSize(modalH)));
  }

  private drawRow(ctx: CanvasRenderingContext2D, rect: RowRect, node: GraphNode2D): void {
    ctx.fillStyle = 'rgba(50, 39, 30, 0.86)';
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 7);
    ctx.fill();
    ctx.strokeStyle = Theme.colors.border;
    ctx.stroke();
    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `600 12px ${Theme.fonts.sans}`;
    ctx.textAlign = 'left';
    ctx.fillText(node.name, rect.x + 14, rect.y + 16);
    ctx.fillStyle = Theme.colors.textMuted;
    ctx.font = `500 10px ${Theme.fonts.sans}`;
    ctx.fillText(`${Theme.getNodeTypeLabel(node.type)} · 点击恢复`, rect.x + 14, rect.y + 32);
    ctx.fillStyle = Theme.colors.borderHighlight;
    ctx.font = `700 16px ${Theme.fonts.sans}`;
    ctx.textAlign = 'right';
    ctx.fillText('↩', rect.x + rect.w - 14, rect.y + 22);
  }

  private drawButton(
    ctx: CanvasRenderingContext2D,
    rect: { x: number; y: number; w: number; h: number },
    label: string,
    active: boolean,
  ): void {
    ctx.fillStyle = active ? Theme.colors.borderActive : 'rgba(30, 24, 19, 0.94)';
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 8);
    ctx.fill();
    ctx.strokeStyle = active ? Theme.colors.borderHighlight : Theme.colors.border;
    ctx.stroke();
    ctx.fillStyle = active ? '#18120E' : Theme.colors.textMid;
    ctx.font = `600 11px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);
  }

  private inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }
}
