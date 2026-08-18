import { Entity } from '@vectojs/core';
import type { GraphViewport } from '../scene/GraphViewport';
import type { GraphNode2D } from '../scene/types';
import { getCanvasCtx, Theme } from './theme';

interface MinimapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MinimapProjection {
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  drawRect: MinimapRect;
  points: Map<string, { x: number; y: number }>;
  worldAt(x: number, y: number): { x: number; y: number } | null;
  pointAt(x: number, y: number): { x: number; y: number };
}

export function createMinimapProjection(
  nodes: readonly GraphNode2D[],
  rect: MinimapRect,
): MinimapProjection | null {
  const positioned = nodes.filter(
    (node): node is GraphNode2D & { x: number; y: number } =>
      Number.isFinite(node.x) && Number.isFinite(node.y),
  );
  if (positioned.length === 0 || rect.w <= 0 || rect.h <= 0) return null;

  let minX = Math.min(...positioned.map((node) => node.x));
  let maxX = Math.max(...positioned.map((node) => node.x));
  let minY = Math.min(...positioned.map((node) => node.y));
  let maxY = Math.max(...positioned.map((node) => node.y));
  const padX = Math.max(24, (maxX - minX) * 0.06);
  const padY = Math.max(24, (maxY - minY) * 0.06);
  minX -= padX;
  maxX += padX;
  minY -= padY;
  maxY += padY;
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const scale = Math.min(rect.w / spanX, rect.h / spanY);
  const drawW = spanX * scale;
  const drawH = spanY * scale;
  const offsetX = rect.x + (rect.w - drawW) / 2;
  const offsetY = rect.y + (rect.h - drawH) / 2;
  const points = new Map<string, { x: number; y: number }>();
  for (const node of positioned) {
    points.set(node.id, {
      x: offsetX + (node.x - minX) * scale,
      y: offsetY + (node.y - minY) * scale,
    });
  }
  return {
    bounds: { minX, minY, maxX, maxY },
    drawRect: { x: offsetX, y: offsetY, w: drawW, h: drawH },
    points,
    worldAt: (x, y) =>
      x >= offsetX && x <= offsetX + drawW && y >= offsetY && y <= offsetY + drawH
        ? { x: minX + (x - offsetX) / scale, y: minY + (y - offsetY) / scale }
        : null,
    pointAt: (x, y) => ({ x: offsetX + (x - minX) * scale, y: offsetY + (y - minY) * scale }),
  };
}

function linkId(endpoint: string | GraphNode2D): string {
  return typeof endpoint === 'string' ? endpoint : endpoint.id;
}

export class Minimap extends Entity {
  private viewport: GraphViewport;
  private widthPx = 170;
  private heightPx = 126;
  private enabled = true;
  private mapRect: MinimapRect = { x: 0, y: 0, w: 0, h: 0 };
  private projection: MinimapProjection | null = null;

  constructor(viewport: GraphViewport) {
    super();
    this.id = 'minimap';
    this.interactive = true;
    this.viewport = viewport;
  }

  public handleClick(x: number, y: number): boolean {
    if (!this.enabled || !this.inRect(x, y, this.mapRect)) return false;
    if (!this.projection) {
      this.viewport.fitToView();
      return true;
    }
    const world = this.projection.worldAt(x, y);
    if (!world) return false;
    this.viewport.centerWorldAt(world.x, world.y);
    return true;
  }

  isPointInside(x: number, y: number): boolean {
    return this.enabled && this.inRect(x, y, this.getFrameRect());
  }

  render(r: unknown): void {
    if (!this.enabled) return;
    const ctx = getCanvasCtx(r);
    const frame = this.getFrameRect();
    this.mapRect = { x: frame.x + 10, y: frame.y + 25, w: frame.w - 20, h: frame.h - 35 };

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 16;
    ctx.fillStyle = 'rgba(40, 31, 24, 0.92)';
    ctx.beginPath();
    ctx.roundRect(frame.x, frame.y, frame.w, frame.h, 8);
    ctx.fill();
    ctx.strokeStyle = Theme.colors.border;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = Theme.colors.borderHighlight;
    ctx.font = `700 10px ${Theme.fonts.sans}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('🧭 小地图 · 点击定位', frame.x + 10, frame.y + 8);

    const nodes = this.viewport.getNodes();
    this.projection = createMinimapProjection(nodes, this.mapRect);
    if (!this.projection) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(this.mapRect.x, this.mapRect.y, this.mapRect.w, this.mapRect.h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(243, 196, 118, 0.38)';
    ctx.lineWidth = 0.8;
    for (const link of this.viewport.getLinks()) {
      const source = this.projection.points.get(linkId(link.source));
      const target = this.projection.points.get(linkId(link.target));
      if (!source || !target) continue;
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
    }
    for (const node of nodes) {
      const point = this.projection.points.get(node.id);
      if (!point) continue;
      ctx.fillStyle = node.color || Theme.getNodeColor(node.type);
      ctx.beginPath();
      ctx.arc(point.x, point.y, node.type === 'author' ? 2.6 : 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    const graphRect = this.viewport.getGraphScreenRect();
    const topLeft = this.viewport.screenToWorld(graphRect.x, graphRect.y);
    const bottomRight = this.viewport.screenToWorld(
      graphRect.x + graphRect.w,
      graphRect.y + graphRect.h,
    );
    const a = this.projection.pointAt(topLeft.x, topLeft.y);
    const b = this.projection.pointAt(bottomRight.x, bottomRight.y);
    const draw = this.projection.drawRect;
    const minFrame = 8;
    const boxX = Math.max(draw.x, Math.min(a.x, draw.x + draw.w - minFrame));
    const boxY = Math.max(draw.y, Math.min(a.y, draw.y + draw.h - minFrame));
    const boxRight = Math.max(boxX + minFrame, Math.min(b.x, draw.x + draw.w));
    const boxBottom = Math.max(boxY + minFrame, Math.min(b.y, draw.y + draw.h));
    ctx.strokeStyle = Theme.colors.borderActive;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(boxX, boxY, boxRight - boxX, boxBottom - boxY);
    ctx.restore();
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.scene?.markDirty();
  }

  private getFrameRect(): MinimapRect {
    const margin = this.scene?.width < 600 ? 12 : 24;
    return {
      x: margin,
      y: (this.scene?.height ?? 0) - this.heightPx - margin,
      w: this.widthPx,
      h: this.heightPx,
    };
  }

  private inRect(x: number, y: number, rect: MinimapRect): boolean {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }
}
