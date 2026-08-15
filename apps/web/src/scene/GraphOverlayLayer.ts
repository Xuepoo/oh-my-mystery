import { Entity } from '@vectojs/core';
import { getCanvasCtx, Theme } from '../ui/theme';
import type { GraphViewport } from './GraphViewport';
import type { GraphNode2D } from './types';

interface NodeScreenBadge {
  id: string;
  entity: GraphNode2D;
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

export class GraphOverlayLayer extends Entity {
  private viewport: GraphViewport;
  private hoveredEntity: GraphNode2D | null = null;
  private pulsePhase = 0;
  private ripplePhase = 0;
  private nodeBadges: NodeScreenBadge[] = [];
  private badgePool: NodeScreenBadge[] = [];
  private pillCache = new Map<string, CachedPillInfo>();
  private activeFilter: string | null = null;

  constructor(viewport: GraphViewport) {
    super();
    this.id = 'graph-overlay-layer';
    this.interactive = false;
    this.viewport = viewport;
  }

  isPointInside(_x: number, _y: number): boolean {
    return false;
  }

  setActiveFilter(filter: string | null): void {
    this.activeFilter = filter;
  }

  setHoveredEntity(e: GraphNode2D | null): void {
    this.hoveredEntity = e;
  }

  getNodeAtScreenPoint(x: number, y: number): GraphNode2D | null {
    // Check badges first (topmost)
    for (let i = this.nodeBadges.length - 1; i >= 0; i--) {
      const b = this.nodeBadges[i]!;
      // 1. Check inside Pill
      if (x >= b.pillX && x <= b.pillX + b.pillW && y >= b.pillY && y <= b.pillY + b.pillH) {
        return b.entity;
      }
      // 2. Check near node center (radius 22px)
      const dx = x - b.sx;
      const dy = y - b.sy;
      if (dx * dx + dy * dy <= 484) {
        return b.entity;
      }
    }

    // Check world nodes directly via viewport
    const worldPos = this.viewport.screenToWorld(x, y);
    return this.viewport.graph.findNodeAt(worldPos.x, worldPos.y, 26 / this.viewport.zoom);
  }

  private getCachedPill(ctx: CanvasRenderingContext2D, e: GraphNode2D): CachedPillInfo {
    const id = String(e.id);
    const cached = this.pillCache.get(id);
    if (cached) return cached;

    const name = e.name || id;
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
    const pillH = isAuthor ? 26 : 22;
    const typeColor = e.color || Theme.getNodeColor(type);

    const info: CachedPillInfo = {
      name,
      icon,
      displayText,
      pillW,
      pillH,
      isAuthor,
      typeColor,
    };
    this.pillCache.set(id, info);
    return info;
  }

  render(r: any): void {
    const ctx = getCanvasCtx(r);
    this.viewport.update();

    this.pulsePhase += 0.06;
    this.ripplePhase = (this.ripplePhase + 0.03) % 1;
    const nodes = this.viewport.getNodes();
    if (nodes.length === 0) return;

    const w = this.scene.width;
    const h = this.scene.height;
    const nodeCount = nodes.length;

    // Reset badge list
    this.nodeBadges.length = 0;
    let badgeIndex = 0;

    // 1. Build Screen Coordinates Map for all nodes
    const screenCoordMap = new Map<string, { x: number; y: number }>();
    for (let i = 0; i < nodeCount; i++) {
      const node = nodes[i]!;
      const nx = node.x ?? 0;
      const ny = node.y ?? 0;
      const sc = this.viewport.worldToScreen(nx, ny);
      screenCoordMap.set(node.id, sc);
    }

    // 2. Batched Relational Connection Threads (Links/Edges)
    const links = this.viewport.getLinks();
    const hlEdges = this.viewport.getHighlightEdges();
    const hoveredId = this.hoveredEntity ? String(this.hoveredEntity.id) : null;

    ctx.save();
    ctx.strokeStyle = 'rgba(243, 196, 118, 0.42)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();

    const specialLinks: {
      src: { x: number; y: number };
      tgt: { x: number; y: number };
      isHl: boolean;
    }[] = [];

    for (let i = 0; i < links.length; i++) {
      const link = links[i]!;
      const srcId = typeof link.source === 'object' ? link.source.id : link.source;
      const tgtId = typeof link.target === 'object' ? link.target.id : link.target;

      const src = screenCoordMap.get(srcId);
      const tgt = screenCoordMap.get(tgtId);
      if (!src || !tgt) continue;

      // Skip offscreen links
      if (
        (src.x < -100 && tgt.x < -100) ||
        (src.x > w + 100 && tgt.x > w + 100) ||
        (src.y < -100 && tgt.y < -100) ||
        (src.y > h + 100 && tgt.y > h + 100)
      ) {
        continue;
      }

      const isHl = hlEdges.has(`${srcId}->${tgtId}`) || hlEdges.has(`${tgtId}->${srcId}`);
      const isHoverConn = hoveredId && (srcId === hoveredId || tgtId === hoveredId);

      if (isHl || isHoverConn) {
        specialLinks.push({ src, tgt, isHl: Boolean(isHl) });
      } else {
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
      }
    }
    ctx.stroke();

    // Draw Special / Highlighted Links
    for (const sl of specialLinks) {
      ctx.beginPath();
      if (sl.isHl) {
        ctx.strokeStyle = '#FFE066';
        ctx.lineWidth = 2.8;
      } else {
        ctx.strokeStyle = '#FFAB38';
        ctx.lineWidth = 1.8;
      }
      ctx.moveTo(sl.src.x, sl.src.y);
      ctx.lineTo(sl.tgt.x, sl.tgt.y);
      ctx.stroke();
    }
    ctx.restore();

    // 3. Draw Gravitational Pulse Waves for Master Authors
    const rippleR = 16 + this.ripplePhase * 30;
    const rippleAlpha = (1 - this.ripplePhase) * 0.4;
    ctx.strokeStyle = `rgba(255, 217, 142, ${rippleAlpha.toFixed(3)})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();

    const masterLimit = Math.min(6, nodeCount);
    for (let i = 0; i < masterLimit; i++) {
      const node = nodes[i]!;
      if (node.type !== 'author') continue;

      const sc = screenCoordMap.get(node.id);
      if (!sc || sc.x < -50 || sc.x > w + 50 || sc.y < 64 || sc.y > h + 50) continue;

      ctx.moveTo(sc.x + rippleR, sc.y);
      ctx.arc(sc.x, sc.y, rippleR, 0, Math.PI * 2);
    }
    ctx.stroke();

    // 4. Draw Node Beads & Category Glows with Dynamic Obsidian Radii
    for (let i = 0; i < nodeCount; i++) {
      const node = nodes[i]!;
      const sc = screenCoordMap.get(node.id);
      if (!sc || sc.x < -100 || sc.x > w + 100 || sc.y < 64 || sc.y > h + 50) continue;

      const isHovered = this.hoveredEntity && this.hoveredEntity.id === node.id;
      const baseR =
        (node.radius || (node.type === 'author' ? 12 : 7)) *
        Math.min(1.3, Math.max(0.65, this.viewport.zoom));
      const r = isHovered ? baseR * 1.35 : baseR;

      // Outer glow
      ctx.fillStyle = node.color || Theme.getNodeColor(node.type);
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, r + (isHovered ? 6 : 3.5), 0, Math.PI * 2);
      ctx.globalAlpha = isHovered ? 0.65 : 0.32;
      ctx.fill();
      ctx.globalAlpha = 1.0;

      // Inner bead
      ctx.fillStyle = isHovered ? '#FFFDF9' : node.color || Theme.getNodeColor(node.type);
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, r, 0, Math.PI * 2);
      ctx.fill();

      // Border
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = isHovered ? 1.8 : 1.2;
      ctx.stroke();
    }

    // 5. Draw Badges & Labels with Smart LOD (Skip corner regions under Minimap and Controls)
    let hoveredData: { entity: GraphNode2D; sx: number; sy: number } | null = null;

    for (let i = 0; i < nodeCount; i++) {
      const node = nodes[i]!;
      const sc = screenCoordMap.get(node.id);
      if (!sc || sc.x < -100 || sc.x > w + 100 || sc.y < 64 || sc.y > h + 50) continue;

      // Skip rendering pills that fall directly behind bottom-left Minimap or bottom-right Controls
      if ((sc.x < 215 && sc.y > h - 160) || (sc.x > w - 180 && sc.y > h - 100)) {
        continue;
      }

      const isHovered = this.hoveredEntity && this.hoveredEntity.id === node.id;
      if (isHovered) {
        hoveredData = { entity: node, sx: sc.x, sy: sc.y };
      }

      const pillInfo = this.getCachedPill(ctx, node);
      const matchesFilter = !this.activeFilter || node.type === this.activeFilter;
      const showFullBadge =
        (pillInfo.isAuthor || isHovered || this.viewport.zoom >= 0.7 || nodeCount <= 60) &&
        matchesFilter;

      if (showFullBadge) {
        const pillW = pillInfo.pillW;
        const pillH = pillInfo.pillH;
        const nodeR =
          (node.radius || (node.type === 'author' ? 12 : 7)) *
          Math.min(1.3, Math.max(0.65, this.viewport.zoom));
        const pillX = Math.round(sc.x - pillW / 2);
        const pillY = Math.round(sc.y + nodeR + 6);

        let badge = this.badgePool[badgeIndex];
        if (!badge) {
          badge = {
            id: node.id,
            entity: node,
            sx: sc.x,
            sy: sc.y,
            pillX,
            pillY,
            pillW,
            pillH,
          };
          this.badgePool[badgeIndex] = badge;
        } else {
          badge.id = node.id;
          badge.entity = node;
          badge.sx = sc.x;
          badge.sy = sc.y;
          badge.pillX = pillX;
          badge.pillY = pillY;
          badge.pillW = pillW;
          badge.pillH = pillH;
        }
        this.nodeBadges.push(badge);
        badgeIndex++;

        // Pill Fill
        ctx.fillStyle = isHovered
          ? 'rgba(64, 51, 42, 0.98)'
          : pillInfo.isAuthor
            ? 'rgba(40, 31, 25, 0.94)'
            : 'rgba(32, 25, 20, 0.88)';
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, 5);
        ctx.fill();

        // Pill Border
        ctx.strokeStyle = isHovered
          ? '#FFE066'
          : pillInfo.isAuthor
            ? Theme.colors.borderHighlight
            : Theme.colors.border;
        ctx.lineWidth = isHovered ? 1.5 : 1;
        ctx.stroke();

        // Left Category Color Pill Accent
        ctx.fillStyle = pillInfo.typeColor;
        ctx.beginPath();
        ctx.roundRect(pillX + 3, pillY + 3, 3, pillH - 6, 2);
        ctx.fill();

        // Label Text
        ctx.font = pillInfo.isAuthor
          ? `700 12px ${Theme.fonts.serif}`
          : `600 11px ${Theme.fonts.sans}`;
        ctx.fillStyle = isHovered ? '#FFFDF9' : Theme.colors.textHigh;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pillInfo.displayText, pillX + pillW / 2 + 2, pillY + pillH / 2);
      }
    }

    // 6. Draw Hovered Entity Tooltip Card
    if (hoveredData) {
      this.renderHoverCard(ctx, hoveredData.entity, hoveredData.sx, hoveredData.sy, w, h);
    }
  }

  private renderHoverCard(
    ctx: CanvasRenderingContext2D,
    node: GraphNode2D,
    sx: number,
    sy: number,
    w: number,
    h: number,
  ): void {
    const cardW = 200;
    const cardH = 68;

    let cardX = sx + 18;
    let cardY = sy - 34;

    if (cardX + cardW > w - 16) {
      cardX = sx - cardW - 18;
    }
    if (cardY + cardH > h - 16) {
      cardY = h - cardH - 16;
    }
    if (cardY < 72) {
      cardY = 72;
    }

    ctx.save();
    ctx.fillStyle = 'rgba(28, 20, 15, 0.97)';
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 6);
    ctx.fill();

    ctx.strokeStyle = Theme.colors.borderHighlight;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Type Badge
    const typeLabel = Theme.getNodeTypeLabel(node.type);
    ctx.fillStyle = node.color || Theme.getNodeColor(node.type);
    ctx.beginPath();
    ctx.roundRect(cardX + 10, cardY + 10, 42, 16, 3);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 9px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(typeLabel.split(' / ')[0]!, cardX + 31, cardY + 18);

    // Title
    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `700 13px ${Theme.fonts.serif}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(node.name, cardX + 58, cardY + 18);

    // Action Hint
    ctx.fillStyle = Theme.colors.textLow;
    ctx.font = `500 10px ${Theme.fonts.sans}`;
    ctx.fillText('💡 点击展开邻域与侦探档案', cardX + 10, cardY + 46);

    ctx.restore();
  }
}
