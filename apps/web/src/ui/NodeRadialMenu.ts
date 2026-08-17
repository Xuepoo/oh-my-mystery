import { Entity } from '@vectojs/core';
import type { GraphNode2D } from '../scene/types';
import { getCanvasCtx, Theme } from './theme';

type RadialAction = 'pin' | 'hide' | 'expand' | 'details' | 'layout';

interface RadialSector {
  action: RadialAction;
  icon: string;
  label: string;
  centerAngle: number;
}

const INNER_RADIUS = 38;
const OUTER_RADIUS = 108;
const SECTOR_ANGLE = (Math.PI * 2) / 5;

export interface NodeRadialMenuOptions {
  isPinned: (id: string) => boolean;
  isExpanded: (id: string) => boolean;
  canLoadMore: (id: string) => boolean;
  isNodeLoading: (id: string) => boolean;
  getExpansionProgress: (id: string) => { loaded: number; total?: number };
  onAction: (action: RadialAction, node: GraphNode2D) => void;
}

export class NodeRadialMenu extends Entity {
  private node: GraphNode2D | null = null;
  private center = { x: 0, y: 0 };
  private hoveredAction: RadialAction | null = null;
  private isPinnedCb: (id: string) => boolean;
  private isExpandedCb: (id: string) => boolean;
  private canLoadMoreCb: (id: string) => boolean;
  private isNodeLoadingCb: (id: string) => boolean;
  private getProgressCb: (id: string) => { loaded: number; total?: number };
  private onActionCb: (action: RadialAction, node: GraphNode2D) => void;

  constructor(options: NodeRadialMenuOptions) {
    super();
    this.id = 'node-radial-menu';
    this.interactive = true;
    this.isPinnedCb = options.isPinned;
    this.isExpandedCb = options.isExpanded;
    this.canLoadMoreCb = options.canLoadMore;
    this.isNodeLoadingCb = options.isNodeLoading;
    this.getProgressCb = options.getExpansionProgress;
    this.onActionCb = options.onAction;
  }

  open(node: GraphNode2D, x: number, y: number): void {
    this.node = node;
    this.hoveredAction = null;
    const margin = 112;
    this.center = {
      x: Math.max(margin, Math.min(this.scene.width - margin, x)),
      y: Math.max(136, Math.min(this.scene.height - margin, y)),
    };
    this.scene.markDirty();
  }

  close(): void {
    if (!this.node) return;
    this.node = null;
    this.hoveredAction = null;
    this.scene.markDirty();
  }

  isMenuOpen(): boolean {
    return this.node !== null;
  }

  isPointInside(x: number, y: number): boolean {
    if (!this.node) return false;
    return Math.hypot(x - this.center.x, y - this.center.y) <= 112;
  }

  handleClick(x: number, y: number): boolean {
    if (!this.node) return false;
    const action = this.getActionAt(x, y);
    if (!action) return false;
    const node = this.node;
    this.close();
    this.onActionCb(action, node);
    return true;
  }

  handlePointerMove(x: number, y: number): void {
    if (!this.node) return;
    const action = this.getActionAt(x, y);
    if (action === this.hoveredAction) return;
    this.hoveredAction = action;
    this.scene.markDirty();
  }

  render(r: any): void {
    if (!this.node) return;
    const nodeX = this.node.sx;
    const nodeY = this.node.sy;
    if (typeof nodeX !== 'number' || typeof nodeY !== 'number') {
      this.close();
      return;
    }
    const margin = OUTER_RADIUS + 4;
    this.center = {
      x: Math.max(margin, Math.min(this.scene.width - margin, nodeX)),
      y: Math.max(margin, Math.min(this.scene.height - margin, nodeY)),
    };
    const ctx = getCanvasCtx(r);
    const { x, y } = this.center;
    const pinned = this.isPinnedCb(this.node.id);
    const expanded = this.isExpandedCb(this.node.id);
    const canLoadMore = this.canLoadMoreCb(this.node.id);
    const loading = this.isNodeLoadingCb(this.node.id);
    const progress = this.getProgressCb(this.node.id);
    const progressLabel =
      progress.total !== undefined
        ? ` ${progress.loaded}/${progress.total}`
        : progress.loaded
          ? ` ${progress.loaded}`
          : '';
    const items: RadialSector[] = [
      {
        action: 'pin',
        icon: pinned ? '📌' : '📍',
        label: pinned ? '取消固定' : '固定',
        centerAngle: -Math.PI / 2,
      },
      { action: 'layout', icon: '✣', label: '重排', centerAngle: -Math.PI / 2 + SECTOR_ANGLE },
      {
        action: 'details',
        icon: '📜',
        label: '档案',
        centerAngle: -Math.PI / 2 + SECTOR_ANGLE * 2,
      },
      {
        action: 'expand',
        icon: loading ? '✕' : canLoadMore ? '+' : expanded ? '↩' : '✦',
        label: loading
          ? `取消${progressLabel}`
          : canLoadMore
            ? `更多${progressLabel}`
            : expanded
              ? '收起'
              : '展开',
        centerAngle: -Math.PI / 2 + SECTOR_ANGLE * 3,
      },
      {
        action: 'hide',
        icon: '◌',
        label: '隐藏',
        centerAngle: -Math.PI / 2 + SECTOR_ANGLE * 4,
      },
    ];

    ctx.save();
    for (const item of items) {
      const start = item.centerAngle - SECTOR_ANGLE / 2;
      const end = item.centerAngle + SECTOR_ANGLE / 2;
      ctx.beginPath();
      ctx.arc(x, y, OUTER_RADIUS, start, end);
      ctx.arc(x, y, INNER_RADIUS, end, start, true);
      ctx.closePath();
      ctx.fillStyle =
        this.hoveredAction === item.action ? 'rgba(243, 196, 118, 0.32)' : 'rgba(31, 24, 19, 0.94)';
      ctx.fill();
      ctx.strokeStyle =
        this.hoveredAction === item.action ? Theme.colors.borderActive : Theme.colors.border;
      ctx.lineWidth = this.hoveredAction === item.action ? 1.8 : 1;
      ctx.stroke();

      const labelRadius = (INNER_RADIUS + OUTER_RADIUS) / 2;
      const cx = x + Math.cos(item.centerAngle) * labelRadius;
      const cy = y + Math.sin(item.centerAngle) * labelRadius;
      ctx.fillStyle = Theme.colors.textHigh;
      ctx.font = `600 15px ${Theme.fonts.sans}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.icon, cx, cy - 7);
      ctx.fillStyle = Theme.colors.textMid;
      ctx.font = `600 9px ${Theme.fonts.sans}`;
      ctx.fillText(item.label, cx, cy + 10);
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

  private getActionAt(x: number, y: number): RadialAction | null {
    const dx = x - this.center.x;
    const dy = y - this.center.y;
    const radius = Math.hypot(dx, dy);
    if (radius < INNER_RADIUS || radius > OUTER_RADIUS) return null;

    const angle = Math.atan2(dy, dx);
    const start = -Math.PI / 2 - SECTOR_ANGLE / 2;
    const normalized = (((angle - start) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const actions: RadialAction[] = ['pin', 'layout', 'details', 'expand', 'hide'];
    return actions[Math.floor(normalized / SECTOR_ANGLE)] || null;
  }
}
