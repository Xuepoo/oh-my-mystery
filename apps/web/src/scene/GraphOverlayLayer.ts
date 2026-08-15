import { Entity } from '@vectojs/core';
import type { KgEntity } from '@vectojs/knowledge-graph';
import * as THREE from 'three';
import { getCanvasCtx, Theme } from '../ui/theme';
import type { GraphViewport } from './GraphViewport';

interface NodeScreenBadge {
  id: string;
  entity: KgEntity;
  sx: number;
  sy: number;
  pillX: number;
  pillY: number;
  pillW: number;
  pillH: number;
}

interface CachedPillInfo {
  name: string;
  icon: string;
  displayText: string;
  pillW: number;
  pillH: number;
  isAuthor: boolean;
  typeColor: string;
}

const _projVec = new THREE.Vector3();

export class GraphOverlayLayer extends Entity {
  private viewport: GraphViewport;
  private hoveredEntity: KgEntity | null = null;
  private pulsePhase = 0;
  private ripplePhase = 0;
  private nodeBadges: NodeScreenBadge[] = [];
  private badgePool: NodeScreenBadge[] = [];
  private pillCache = new Map<string, CachedPillInfo>();

  constructor(viewport: GraphViewport) {
    super();
    this.id = 'graph-overlay-layer';
    this.interactive = false;
    this.viewport = viewport;
  }

  isPointInside(_x: number, _y: number): boolean {
    return false;
  }

  setHoveredEntity(e: KgEntity | null): void {
    this.hoveredEntity = e;
  }

  getNodeAtScreenPoint(x: number, y: number): KgEntity | null {
    for (let i = this.nodeBadges.length - 1; i >= 0; i--) {
      const b = this.nodeBadges[i]!;
      // 1. Check inside Pill
      if (x >= b.pillX && x <= b.pillX + b.pillW && y >= b.pillY && y <= b.pillY + b.pillH) {
        return b.entity;
      }
      // 2. Check near node sphere bead (radius 22px)
      const dx = x - b.sx;
      const dy = y - b.sy;
      if (dx * dx + dy * dy <= 484) {
        return b.entity;
      }
    }
    return null;
  }

  private getCachedPill(ctx: CanvasRenderingContext2D, e: KgEntity): CachedPillInfo {
    const id = String(e.id);
    let cached = this.pillCache.get(id);
    if (cached) return cached;

    const labels = e.labels || (e as any).names?.labels || {};
    const name =
      (e as any).name || labels.zh || labels['zh-cn'] || labels.ja || labels.en || labels[''] || id;
    const type = e.type || 'author';
    const isAuthor = type === 'author';
    const icon =
      type === 'author'
        ? '✒️'
        : type === 'work'
          ? '📖'
          : type === 'award'
            ? '🏆'
            : type === 'character'
              ? '🔍'
              : '🔹';

    const displayText = `${icon} ${name}`;
    ctx.font = isAuthor ? `700 12px ${Theme.fonts.serif}` : `600 11px ${Theme.fonts.sans}`;
    const textMetrics = ctx.measureText(displayText);
    const pillW = Math.round(textMetrics.width + 20);
    const pillH = isAuthor ? 24 : 20;

    cached = {
      name,
      icon,
      displayText,
      pillW,
      pillH,
      isAuthor,
      typeColor: Theme.getNodeColor(type),
    };
    this.pillCache.set(id, cached);
    return cached;
  }

  render(renderer: any): void {
    const ctx = getCanvasCtx(renderer);
    const camera = this.viewport.getCamera();
    if (!camera) return;

    this.pulsePhase += 0.06;
    this.ripplePhase = (this.ripplePhase + 0.03) % 1; // 0 to 1 cycle
    const entities = this.viewport.getEntities();
    const positions = this.viewport.getPositions();
    if (!positions || entities.length === 0) return;

    const w = this.scene.width;
    const h = this.scene.height;
    const nodeCount = entities.length;

    // Reset badge list using pooled objects to prevent GC allocations
    this.nodeBadges.length = 0;
    let badgeIndex = 0;

    // 1. Draw Gravitational Pulse Waves for Top Master Authors (Limited to 4 for optimal performance)
    const masterLimit = Math.min(4, nodeCount);
    const rippleR = 14 + this.ripplePhase * 28;
    const rippleAlpha = (1 - this.ripplePhase) * 0.45;
    ctx.strokeStyle = `rgba(255, 217, 142, ${rippleAlpha.toFixed(3)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    for (let i = 0; i < masterLimit; i++) {
      const e = entities[i]!;
      if (e.type !== 'author') continue;

      const x = positions[i * 3]!;
      const y = positions[i * 3 + 1]!;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

      _projVec.set(x, y, 0).project(camera);
      const sx = ((_projVec.x + 1) / 2) * w;
      const sy = ((-_projVec.y + 1) / 2) * h;
      if (sx < -50 || sx > w + 50 || sy < 64 || sy > h + 50) continue;

      ctx.moveTo(sx + rippleR, sy);
      ctx.arc(sx, sy, rippleR, 0, Math.PI * 2);
    }
    ctx.stroke();

    // 2. Draw Node Labels & Badges with Smart LOD and zero GC allocation
    let hoveredData: { entity: KgEntity; sx: number; sy: number } | null = null;

    for (let i = 0; i < nodeCount; i++) {
      const e = entities[i]!;
      const x = positions[i * 3]!;
      const y = positions[i * 3 + 1]!;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

      // Project world coords to screen using reusable vector
      _projVec.set(x, y, 0).project(camera);
      const sx = ((_projVec.x + 1) / 2) * w;
      const sy = ((-_projVec.y + 1) / 2) * h;

      // Skip offscreen or under-header nodes
      if (sx < -100 || sx > w + 100 || sy < 64 || sy > h + 50) continue;

      const isHovered = this.hoveredEntity && this.hoveredEntity.id === e.id;
      if (isHovered) {
        hoveredData = { entity: e, sx, sy };
      }

      const pillInfo = this.getCachedPill(ctx, e);
      const showFullBadge = pillInfo.isAuthor || isHovered || nodeCount <= 40;

      if (showFullBadge) {
        const pillW = pillInfo.pillW;
        const pillH = pillInfo.pillH;
        const pillX = Math.round(sx - pillW / 2);
        const pillY = Math.round(sy + (pillInfo.isAuthor ? 14 : 10));

        let badge = this.badgePool[badgeIndex];
        if (!badge) {
          badge = {
            id: String(e.id),
            entity: e,
            sx,
            sy,
            pillX,
            pillY,
            pillW,
            pillH,
          };
          this.badgePool[badgeIndex] = badge;
        } else {
          badge.id = String(e.id);
          badge.entity = e;
          badge.sx = sx;
          badge.sy = sy;
          badge.pillX = pillX;
          badge.pillY = pillY;
          badge.pillW = pillW;
          badge.pillH = pillH;
        }
        this.nodeBadges.push(badge);
        badgeIndex++;

        // Fast Pill Fill without multi-pass Gaussian blur
        ctx.fillStyle = isHovered
          ? Theme.colors.bgCardHover
          : pillInfo.isAuthor
            ? Theme.colors.bgCard
            : Theme.colors.bgParchmentDark;
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, 5);
        ctx.fill();

        // Crisp Border
        ctx.strokeStyle = isHovered ? Theme.colors.borderActive : pillInfo.typeColor;
        ctx.lineWidth = isHovered ? 2.0 : 1.0;
        ctx.stroke();

        // Label Text
        ctx.font = pillInfo.isAuthor
          ? `700 12px ${Theme.fonts.serif}`
          : `600 11px ${Theme.fonts.sans}`;
        ctx.fillStyle = isHovered ? Theme.colors.borderActive : Theme.colors.textHigh;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(pillInfo.displayText, pillX + 10, pillY + pillH / 2);
      } else {
        // Compact bead for hover hit testing
        let badge = this.badgePool[badgeIndex];
        if (!badge) {
          badge = {
            id: String(e.id),
            entity: e,
            sx,
            sy,
            pillX: sx - 12,
            pillY: sy - 12,
            pillW: 24,
            pillH: 24,
          };
          this.badgePool[badgeIndex] = badge;
        } else {
          badge.id = String(e.id);
          badge.entity = e;
          badge.sx = sx;
          badge.sy = sy;
          badge.pillX = sx - 12;
          badge.pillY = sy - 12;
          badge.pillW = 24;
          badge.pillH = 24;
        }
        this.nodeBadges.push(badge);
        badgeIndex++;
      }
    }

    // 3. Render Hover Effects (Crosshairs & Detail Card) only once if hovered
    if (hoveredData) {
      const { entity: e, sx, sy } = hoveredData;
      const pulse = Math.sin(this.pulsePhase) * 4 + 22;

      ctx.save();
      ctx.strokeStyle = Theme.colors.borderActive;
      ctx.lineWidth = 2;

      // Outer Loupe Reticle
      ctx.beginPath();
      ctx.arc(sx, sy, pulse, 0, Math.PI * 2);
      ctx.stroke();

      // Crosshair Ticks
      ctx.beginPath();
      ctx.moveTo(sx - pulse - 6, sy);
      ctx.lineTo(sx - pulse + 2, sy);
      ctx.moveTo(sx + pulse - 2, sy);
      ctx.lineTo(sx + pulse + 6, sy);
      ctx.moveTo(sx, sy - pulse - 6);
      ctx.lineTo(sx, sy - pulse + 2);
      ctx.moveTo(sx, sy + pulse - 2);
      ctx.lineTo(sx, sy + pulse + 6);
      ctx.stroke();

      this.renderHoverCard(ctx, e, sx, sy);
      ctx.restore();
    }
  }

  private renderHoverCard(
    ctx: CanvasRenderingContext2D,
    entity: KgEntity,
    sx: number,
    sy: number,
  ): void {
    const cardW = 230;
    const cardH = 92;
    const padding = 14;

    const w = this.scene.width;
    const h = this.scene.height;

    // Smart positioning: flip if too close to right or bottom edges
    let cardX = sx + 24;
    let cardY = sy - 46;

    if (cardX + cardW > w - 20) {
      cardX = sx - cardW - 24;
    }
    if (cardY + cardH > h - 20) {
      cardY = h - cardH - 20;
    }
    if (cardY < 70) {
      cardY = 70;
    }

    // Card Background Box
    ctx.fillStyle = 'rgba(40, 31, 24, 0.94)';
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 8);
    ctx.fill();

    // Gold Border
    ctx.strokeStyle = Theme.colors.borderHighlight;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const labels = entity.labels || (entity as any).names?.labels || {};
    const name =
      (entity as any).name || labels.zh || labels['zh-cn'] || labels.ja || labels.en || entity.id;
    const type = entity.type || 'author';
    const typeZh = Theme.getNodeTypeLabel(type);

    // Title
    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `700 13px ${Theme.fonts.serif}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(name, cardX + padding, cardY + padding);

    // Subtitle / Type badge
    ctx.fillStyle = Theme.getNodeColor(type);
    ctx.font = `600 11px ${Theme.fonts.sans}`;
    ctx.fillText(typeZh, cardX + padding, cardY + padding + 20);

    // Coordinate Telemetry
    ctx.fillStyle = Theme.colors.textLow;
    ctx.font = `400 10px ${Theme.fonts.sans}`;
    ctx.fillText(
      `ID: ${entity.id} • 坐标 (${Math.round(sx)}, ${Math.round(sy)})`,
      cardX + padding,
      cardY + padding + 38,
    );

    // Bottom Action Hint
    ctx.fillStyle = Theme.colors.borderHighlight;
    ctx.font = `600 10px ${Theme.fonts.sans}`;
    ctx.fillText('💡 单击查看完整案卷 • 双击展开关联谱系', cardX + padding, cardY + cardH - 18);
  }
}
