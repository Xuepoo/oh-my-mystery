import { Entity } from '@vectojs/core';
import type { GraphViewport } from '../scene/GraphViewport';
import { getCanvasCtx, Theme } from './theme';

const RELATIONS: { predicates: string[]; label: string; color: string }[] = [
  { predicates: ['author', 'aozora_role'], label: '创作', color: '#56B4E9' },
  { predicates: ['publisher'], label: '出版', color: '#E69F00' },
  { predicates: ['award_received'], label: '获奖', color: '#E74C68' },
  { predicates: ['characters'], label: '角色', color: '#9B7EDE' },
  { predicates: ['series'], label: '系列', color: '#45B89C' },
];

interface FilterRect {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class RelationshipFilterBar extends Entity {
  private viewport: GraphViewport;
  private expanded = false;
  private active = new Set<number>();
  private toggleRect = { x: 16, y: 76, w: 104, h: 44 };
  private filterRects: FilterRect[] = [];
  private onChangeCb: (predicates: ReadonlySet<string> | null) => void;
  private enabled = true;

  constructor(viewport: GraphViewport, onChange: (predicates: ReadonlySet<string> | null) => void) {
    super();
    this.id = 'relationship-filter-bar';
    this.interactive = true;
    this.viewport = viewport;
    this.onChangeCb = onChange;
  }

  isPointInside(x: number, y: number): boolean {
    if (!this.enabled) return false;
    if (this.inRect(x, y, this.toggleRect)) return true;
    return this.expanded && this.filterRects.some((rect) => this.inRect(x, y, rect));
  }

  handleClick(x: number, y: number): boolean {
    if (!this.enabled) return false;
    if (this.inRect(x, y, this.toggleRect)) {
      this.expanded = !this.expanded;
      this.scene.markDirty();
      return true;
    }
    for (const rect of this.filterRects) {
      if (!this.inRect(x, y, rect)) continue;
      if (this.active.has(rect.index)) this.active.delete(rect.index);
      else this.active.add(rect.index);
      const predicates = new Set<string>();
      for (const index of this.active) {
        for (const predicate of RELATIONS[index]!.predicates) predicates.add(predicate);
      }
      this.onChangeCb(predicates.size ? predicates : null);
      this.scene.markDirty();
      return true;
    }
    return false;
  }

  render(r: any): void {
    if (!this.enabled) return;
    const ctx = getCanvasCtx(r);
    const counts = new Map<string, number>();
    for (const link of this.viewport.getLinks()) {
      counts.set(link.predicate, (counts.get(link.predicate) || 0) + 1);
    }
    this.toggleRect = { x: 16, y: 76, w: 104, h: 44 };
    this.drawPill(
      ctx,
      this.toggleRect,
      `关系 ${this.active.size ? this.active.size : '全部'}`,
      this.expanded,
      Theme.colors.borderHighlight,
    );
    this.filterRects = [];
    if (!this.expanded) return;

    const mobile = this.scene.width < 640;
    const gap = 8;
    const itemW = mobile ? Math.max(88, (this.scene.width - 32 - gap * 2) / 3) : 102;
    for (let i = 0; i < RELATIONS.length; i++) {
      const relation = RELATIONS[i]!;
      const col = mobile ? i % 3 : i;
      const row = mobile ? Math.floor(i / 3) : 0;
      const rect = {
        index: i,
        x: 16 + col * (itemW + gap),
        y: 128 + row * 52,
        w: itemW,
        h: 44,
      };
      this.filterRects.push(rect);
      const count = relation.predicates.reduce((sum, p) => sum + (counts.get(p) || 0), 0);
      this.drawPill(ctx, rect, `${relation.label} ${count}`, this.active.has(i), relation.color);
    }
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.scene?.markDirty();
  }

  private drawPill(
    ctx: CanvasRenderingContext2D,
    rect: { x: number; y: number; w: number; h: number },
    label: string,
    active: boolean,
    color: string,
  ): void {
    ctx.fillStyle = active ? color : 'rgba(30, 24, 19, 0.94)';
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 8);
    ctx.fill();
    ctx.strokeStyle = active ? '#FFF7E8' : Theme.colors.border;
    ctx.lineWidth = active ? 1.5 : 1;
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
