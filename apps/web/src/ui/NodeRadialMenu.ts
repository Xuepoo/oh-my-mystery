import { Entity } from '@vectojs/core';
import type { GraphNode2D } from '../scene/types';
import { getCanvasCtx, Theme } from './theme';

type RadialAction = 'pin' | 'hide' | 'expand' | 'details';

export interface NodeRadialMenuOptions {
  isPinned: (id: string) => boolean;
  isExpanded: (id: string) => boolean;
  onAction: (action: RadialAction, node: GraphNode2D) => void;
}

export class NodeRadialMenu extends Entity {
  private node: GraphNode2D | null = null;
  private center = { x: 0, y: 0 };
  private actionRects: { action: RadialAction; x: number; y: number; r: number }[] = [];
  private isPinnedCb: (id: string) => boolean;
  private isExpandedCb: (id: string) => boolean;
  private onActionCb: (action: RadialAction, node: GraphNode2D) => void;

  constructor(options: NodeRadialMenuOptions) {
    super();
    this.id = 'node-radial-menu';
    this.interactive = true;
    this.isPinnedCb = options.isPinned;
    this.isExpandedCb = options.isExpanded;
    this.onActionCb = options.onAction;
  }

  open(node: GraphNode2D, x: number, y: number): void {
    this.node = node;
    const margin = 92;
    this.center = {
      x: Math.max(margin, Math.min(this.scene.width - margin, x)),
      y: Math.max(136, Math.min(this.scene.height - margin, y)),
    };
    this.scene.markDirty();
  }

  close(): void {
    if (!this.node) return;
    this.node = null;
    this.actionRects = [];
    this.scene.markDirty();
  }

  isMenuOpen(): boolean {
    return this.node !== null;
  }

  isPointInside(x: number, y: number): boolean {
    if (!this.node) return false;
    return Math.hypot(x - this.center.x, y - this.center.y) <= 96;
  }

  handleClick(x: number, y: number): boolean {
    if (!this.node) return false;
    for (const item of this.actionRects) {
      if (Math.hypot(x - item.x, y - item.y) <= item.r) {
        const node = this.node;
        this.close();
        this.onActionCb(item.action, node);
        return true;
      }
    }
    return false;
  }

  render(r: any): void {
    if (!this.node) return;
    const ctx = getCanvasCtx(r);
    const { x, y } = this.center;
    const pinned = this.isPinnedCb(this.node.id);
    const expanded = this.isExpandedCb(this.node.id);
    const items: { action: RadialAction; icon: string; label: string; angle: number }[] = [
      {
        action: 'pin',
        icon: pinned ? '📌' : '📍',
        label: pinned ? '取消固定' : '固定',
        angle: -Math.PI / 2,
      },
      { action: 'details', icon: '📜', label: '档案', angle: 0 },
      {
        action: 'expand',
        icon: expanded ? '↩' : '✦',
        label: expanded ? '收起' : '展开',
        angle: Math.PI / 2,
      },
      { action: 'hide', icon: '◌', label: '隐藏', angle: Math.PI },
    ];

    ctx.save();
    ctx.fillStyle = 'rgba(20, 15, 12, 0.82)';
    ctx.beginPath();
    ctx.arc(x, y, 92, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = Theme.colors.borderHighlight;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    this.actionRects = [];
    for (const item of items) {
      const cx = x + Math.cos(item.angle) * 62;
      const cy = y + Math.sin(item.angle) * 62;
      this.actionRects.push({ action: item.action, x: cx, y: cy, r: 25 });
      ctx.fillStyle = Theme.colors.bgCard;
      ctx.beginPath();
      ctx.arc(cx, cy, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = Theme.colors.border;
      ctx.stroke();
      ctx.fillStyle = Theme.colors.textHigh;
      ctx.font = `600 14px ${Theme.fonts.sans}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.icon, cx, cy - 4);
      ctx.fillStyle = Theme.colors.textMid;
      ctx.font = `600 8px ${Theme.fonts.sans}`;
      ctx.fillText(item.label, cx, cy + 11);
    }

    ctx.fillStyle = this.node.color || Theme.getNodeColor(this.node.type);
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFF7E8';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}
