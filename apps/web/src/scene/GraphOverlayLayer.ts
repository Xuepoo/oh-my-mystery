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

export class GraphOverlayLayer extends Entity {
  private viewport: GraphViewport;
  private hoveredEntity: KgEntity | null = null;
  private pulsePhase = 0;
  private ripplePhase = 0;
  private nodeBadges: NodeScreenBadge[] = [];

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

    this.nodeBadges = [];

    // 1. Draw Gravitational Pulse Waves for Master Authors
    ctx.save();
    for (let i = 0; i < Math.min(8, nodeCount); i++) {
      const e = entities[i]!;
      if (e.type !== 'author') continue;

      const x = positions[i * 3]!;
      const y = positions[i * 3 + 1]!;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

      const v = new THREE.Vector3(x, y, 0);
      v.project(camera);
      const sx = ((v.x + 1) / 2) * w;
      const sy = ((-v.y + 1) / 2) * h;
      if (sx < -50 || sx > w + 50 || sy < 64 || sy > h + 50) continue;

      // Expanding wave ring
      const rippleR = 14 + this.ripplePhase * 28;
      const rippleAlpha = (1 - this.ripplePhase) * 0.45;
      ctx.strokeStyle = `rgba(255, 217, 142, ${rippleAlpha.toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, rippleR, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // 2. Draw Node Labels & Badges with Smart LOD
    ctx.save();
    for (let i = 0; i < nodeCount; i++) {
      const e = entities[i]!;
      const x = positions[i * 3]!;
      const y = positions[i * 3 + 1]!;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

      // Project world coords to screen
      const v = new THREE.Vector3(x, y, 0);
      v.project(camera);

      const sx = ((v.x + 1) / 2) * w;
      const sy = ((-v.y + 1) / 2) * h;

      // Skip offscreen or under-header nodes
      if (sx < -100 || sx > w + 100 || sy < 64 || sy > h + 50) continue;

      const labels = e.labels || (e as any).names?.labels || {};
      const name =
        (e as any).name ||
        labels.zh ||
        labels['zh-cn'] ||
        labels.ja ||
        labels.en ||
        labels[''] ||
        e.id;
      const type = e.type || 'author';
      const isHovered = this.hoveredEntity && this.hoveredEntity.id === e.id;
      const typeColor = Theme.getNodeColor(type);

      const isAuthor = type === 'author';
      const showFullBadge = isAuthor || isHovered || nodeCount <= 35;

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

      // Glowing Aura & Loupe Crosshair on Hover
      if (isHovered) {
        const pulse = Math.sin(this.pulsePhase) * 4 + 22;
        ctx.save();
        ctx.strokeStyle = Theme.colors.borderActive;
        ctx.lineWidth = 2;
        ctx.shadowColor = Theme.colors.borderActive;
        ctx.shadowBlur = 20;

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
        ctx.restore();
      }

      if (showFullBadge) {
        // Nameplate Pill
        ctx.font = isAuthor ? `700 12px ${Theme.fonts.serif}` : `600 11px ${Theme.fonts.sans}`;
        const displayText = `${icon} ${name}`;
        const textMetrics = ctx.measureText(displayText);
        const pillW = Math.round(textMetrics.width + 20);
        const pillH = isAuthor ? 24 : 20;
        const pillX = Math.round(sx - pillW / 2);
        const pillY = Math.round(sy + (isAuthor ? 14 : 10));

        this.nodeBadges.push({
          id: String(e.id),
          entity: e,
          sx,
          sy,
          pillX,
          pillY,
          pillW,
          pillH,
        });

        // Pill Background (Luminous Warm Lacquer with Depth)
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 2;

        ctx.fillStyle = isHovered
          ? Theme.colors.bgCardHover
          : isAuthor
            ? Theme.colors.bgCard
            : Theme.colors.bgParchmentDark;
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, 5);
        ctx.fill();

        // Pill Border with Bright Gold Foil
        ctx.strokeStyle = isHovered ? Theme.colors.borderActive : typeColor;
        ctx.lineWidth = isHovered ? 2.0 : 1.2;
        ctx.stroke();
        ctx.restore();

        // Label Text
        ctx.fillStyle = isHovered ? Theme.colors.borderActive : Theme.colors.textHigh;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(displayText, pillX + 10, pillY + pillH / 2);
      } else {
        // Compact bead registry for hover hit testing
        this.nodeBadges.push({
          id: String(e.id),
          entity: e,
          sx,
          sy,
          pillX: sx - 12,
          pillY: sy - 12,
          pillW: 24,
          pillH: 24,
        });
      }

      // Hovered Magnifying Detail Card
      if (isHovered) {
        this.renderHoverCard(ctx, e, sx, sy);
      }
    }
    ctx.restore();
  }

  private renderHoverCard(
    ctx: CanvasRenderingContext2D,
    entity: KgEntity,
    sx: number,
    sy: number,
  ): void {
    const cardW = 230;
    const cardH = 92;
    const cardX = Math.round(Math.min(this.scene.width - cardW - 20, Math.max(20, sx + 26)));
    const cardY = Math.round(Math.min(this.scene.height - cardH - 20, Math.max(80, sy - 100)));

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
    ctx.shadowBlur = 28;

    // Card background
    ctx.fillStyle = Theme.colors.bgCard;
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 8);
    ctx.fill();

    ctx.strokeStyle = Theme.colors.borderActive;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.restore();

    // Type Badge
    const typeLabel = Theme.getNodeTypeLabel(entity.type);
    ctx.fillStyle = Theme.getNodeColor(entity.type);
    ctx.beginPath();
    ctx.roundRect(cardX + 12, cardY + 12, 72, 22, 4);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 10px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(typeLabel.split(' / ')[0]!, cardX + 48, cardY + 23);

    // Primary Name
    const labels = entity.labels || (entity as any).names?.labels || {};
    const name =
      (entity as any).name || labels.zh || labels['zh-cn'] || labels.ja || labels.en || entity.id;
    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `700 15px ${Theme.fonts.serif}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(name, cardX + 92, cardY + 14);

    // Tip Hint
    ctx.fillStyle = Theme.colors.borderActive;
    ctx.font = `600 11px ${Theme.fonts.sans}`;
    ctx.fillText('⚡ 单击节点：展开 1-Hop 案卷', cardX + 12, cardY + 44);

    ctx.fillStyle = Theme.colors.textMid;
    ctx.font = `400 11px ${Theme.fonts.sans}`;
    ctx.fillText('🖱️ 拖拽画布自由探索 / 滚轮缩放', cardX + 12, cardY + 66);
  }
}
