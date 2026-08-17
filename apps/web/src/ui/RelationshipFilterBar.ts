import { Entity } from '@vectojs/core';
import type { GraphViewport } from '../scene/GraphViewport';
import { getCanvasCtx, Theme } from './theme';
import { truncateText, withClip } from './text-layout';

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

interface RelationshipFilterLayout {
  toggle: Omit<FilterRect, 'index'>;
  filters: FilterRect[];
}

export function getRelationshipFilterLayout(
  width: number,
  filterCount: number,
): RelationshipFilterLayout {
  const toggle = { x: 16, y: 76, w: 104, h: 44 };
  const mobile = width < 640;
  const gap = 8;
  const startX = mobile ? 16 : toggle.x + toggle.w + gap;
  const availableWidth = Math.max(0, width - startX - 16);
  const columns = mobile ? 3 : Math.max(1, Math.floor((availableWidth + gap) / (102 + gap)));
  const itemW = mobile ? Math.max(0, (width - 32 - gap * 2) / 3) : 102;
  const startY = mobile ? 128 : toggle.y;
  const filters = Array.from({ length: filterCount }, (_, index) => ({
    index,
    x: startX + (index % columns) * (itemW + gap),
    y: startY + Math.floor(index / columns) * 52,
    w: itemW,
    h: 44,
  }));

  return { toggle, filters };
}

export class RelationshipFilterBar extends Entity {
  private viewport: GraphViewport;
  private expanded = false;
  private active = new Set<number>();
  private onChangeCb: (predicates: ReadonlySet<string> | null) => void;
  private enabled = true;

  get toggleRect(): { x: number; y: number; w: number; h: number } {
    return getRelationshipFilterLayout(this.scene?.width ?? 1280, RELATIONS.length).toggle;
  }

  constructor(viewport: GraphViewport, onChange: (predicates: ReadonlySet<string> | null) => void) {
    super();
    this.id = 'relationship-filter-bar';
    this.interactive = true;
    this.viewport = viewport;
    this.onChangeCb = onChange;
  }

  isPointInside(x: number, y: number): boolean {
    if (!this.enabled) return false;
    const layout = getRelationshipFilterLayout(this.scene.width, RELATIONS.length);
    if (this.inRect(x, y, layout.toggle)) return true;
    return this.expanded && layout.filters.some((rect) => this.inRect(x, y, rect));
  }

  handleClick(x: number, y: number): boolean {
    if (!this.enabled) return false;
    const layout = getRelationshipFilterLayout(this.scene.width, RELATIONS.length);
    if (this.inRect(x, y, layout.toggle)) {
      this.expanded = !this.expanded;
      this.scene.markDirty();
      return true;
    }
    if (!this.expanded) return false;
    for (const rect of layout.filters) {
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
    ctx.save();
    try {
      const counts = new Map<string, number>();
      for (const link of this.viewport.getLinks()) {
        counts.set(link.predicate, (counts.get(link.predicate) || 0) + 1);
      }
      const layout = getRelationshipFilterLayout(this.scene.width, RELATIONS.length);
      this.drawPill(
        ctx,
        layout.toggle,
        `关系 ${this.active.size ? this.active.size : '全部'}`,
        this.expanded,
        Theme.colors.borderHighlight,
      );
      if (!this.expanded) return;

      for (const rect of layout.filters) {
        const relation = RELATIONS[rect.index]!;
        const count = relation.predicates.reduce((sum, p) => sum + (counts.get(p) || 0), 0);
        this.drawPill(
          ctx,
          rect,
          `${relation.label} ${count}`,
          this.active.has(rect.index),
          relation.color,
        );
      }
    } finally {
      ctx.restore();
    }
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.scene?.markDirty();
  }

  getActiveIndexes(): readonly number[] {
    return [...this.active];
  }

  getInstrumentationState(): { expanded: boolean; activeIndexes: readonly number[] } {
    return { expanded: this.expanded, activeIndexes: [...this.active] };
  }

  getInstrumentationTargets(): readonly {
    id: string;
    rect: { x: number; y: number; w: number; h: number };
  }[] {
    if (!this.enabled) return [];
    const layout = getRelationshipFilterLayout(this.scene?.width ?? 1280, RELATIONS.length);
    const targets = [{ id: 'tool.relationship', rect: { ...layout.toggle } }];
    if (this.expanded) {
      for (const rect of layout.filters) {
        targets.push({
          id: `tool.relationship.${RELATIONS[rect.index]!.predicates[0]}`,
          rect: { ...rect },
        });
      }
    }
    return targets;
  }

  getActivePredicates(): readonly string[] {
    const predicates = new Set<string>();
    for (const index of this.active) {
      for (const predicate of RELATIONS[index]!.predicates) predicates.add(predicate);
    }
    return [...predicates];
  }

  setActiveIndexes(indexes: readonly number[]): void {
    this.active = new Set(indexes.filter((index) => index >= 0 && index < RELATIONS.length));
    const predicates = new Set<string>();
    for (const index of this.active) {
      for (const predicate of RELATIONS[index]!.predicates) predicates.add(predicate);
    }
    this.onChangeCb(predicates.size ? predicates : null);
    this.scene?.markDirty();
  }

  private drawPill(
    ctx: CanvasRenderingContext2D,
    rect: { x: number; y: number; w: number; h: number },
    label: string,
    active: boolean,
    color: string,
  ): void {
    withClip(ctx, rect, () => {
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
      ctx.fillText(
        truncateText(ctx, label, Math.max(0, rect.w - 16)),
        rect.x + rect.w / 2,
        rect.y + rect.h / 2,
      );
    });
  }

  private inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }
}
