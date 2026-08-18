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
  font: string;
}

export interface LabelPlacementCandidate {
  id: string;
  sx: number;
  sy: number;
  width: number;
  height: number;
  radius: number;
  hovered?: boolean;
  selected?: boolean;
  onPath?: boolean;
  degree?: number;
}

export interface LabelPlacement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  side: 'below' | 'above' | 'right' | 'left';
}

interface LabelPlacementOptions {
  viewport: { x: number; y: number; width: number; height: number };
  maxLabels?: number;
  occupied?: readonly { x: number; y: number; width: number; height: number }[];
  gap?: number;
  padding?: number;
  // During active physics, pin labels to a fixed side (below) so oscillating
  // nodes do not make labels flip between below/above/right/left each frame.
  stable?: boolean;
}

function rectanglesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

class RectangleGrid {
  private readonly cells = new Map<
    string,
    { x: number; y: number; width: number; height: number }[]
  >();

  constructor(private readonly cellSize = 64) {}

  add(rect: { x: number; y: number; width: number; height: number }): void {
    for (const key of this.keys(rect)) {
      const cell = this.cells.get(key);
      if (cell) cell.push(rect);
      else this.cells.set(key, [rect]);
    }
  }

  overlaps(rect: { x: number; y: number; width: number; height: number }): boolean {
    for (const key of this.keys(rect)) {
      const cell = this.cells.get(key);
      if (cell?.some((candidate) => rectanglesOverlap(rect, candidate))) return true;
    }
    return false;
  }

  private keys(rect: { x: number; y: number; width: number; height: number }): string[] {
    const minX = Math.floor(rect.x / this.cellSize);
    const maxX = Math.floor((rect.x + rect.width) / this.cellSize);
    const minY = Math.floor(rect.y / this.cellSize);
    const maxY = Math.floor((rect.y + rect.height) / this.cellSize);
    const keys: string[] = [];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) keys.push(`${x}:${y}`);
    }
    return keys;
  }
}

function labelPriority(candidate: LabelPlacementCandidate): number {
  if (candidate.hovered) return 0;
  if (candidate.selected) return 1;
  if (candidate.onPath) return 2;
  return 3;
}

/** Places labels deterministically in screen space without moving them away from their nodes. */
export function placeGraphLabels(
  candidates: readonly LabelPlacementCandidate[],
  options: LabelPlacementOptions,
): LabelPlacement[] {
  const gap = options.gap ?? 6;
  const padding = options.padding ?? 4;
  const maxLabels = Math.max(0, options.maxLabels ?? candidates.length);
  const viewport = options.viewport;
  if (
    !Number.isFinite(viewport.x) ||
    !Number.isFinite(viewport.y) ||
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= padding * 2 ||
    viewport.height <= padding * 2
  ) {
    return [];
  }

  const occupied = new RectangleGrid();
  for (const rect of options.occupied ?? []) occupied.add(rect);
  const accepted: LabelPlacement[] = [];
  const ordered = candidates
    .filter(
      (candidate) =>
        Number.isFinite(candidate.sx) &&
        Number.isFinite(candidate.sy) &&
        Number.isFinite(candidate.width) &&
        Number.isFinite(candidate.height) &&
        Number.isFinite(candidate.radius) &&
        candidate.width > 0 &&
        candidate.height > 0,
    )
    .sort((a, b) => {
      const priority = labelPriority(a) - labelPriority(b);
      if (priority) return priority;
      const degree = (b.degree ?? 0) - (a.degree ?? 0);
      return degree || a.id.localeCompare(b.id);
    });

  for (const candidate of ordered) {
    if (accepted.length >= maxLabels) break;
    const offset = Math.max(0, candidate.radius) + gap;
    const positions: LabelPlacement[] = [
      {
        id: candidate.id,
        x: candidate.sx - candidate.width / 2,
        y: candidate.sy + offset,
        width: candidate.width,
        height: candidate.height,
        side: 'below',
      },
      {
        id: candidate.id,
        x: candidate.sx - candidate.width / 2,
        y: candidate.sy - offset - candidate.height,
        width: candidate.width,
        height: candidate.height,
        side: 'above',
      },
      {
        id: candidate.id,
        x: candidate.sx + offset,
        y: candidate.sy - candidate.height / 2,
        width: candidate.width,
        height: candidate.height,
        side: 'right',
      },
      {
        id: candidate.id,
        x: candidate.sx - offset - candidate.width,
        y: candidate.sy - candidate.height / 2,
        width: candidate.width,
        height: candidate.height,
        side: 'left',
      },
    ];

    const placement = options.stable
      ? (positions[0] ?? null)
      : positions.find(
          (position) =>
            position.x >= viewport.x + padding &&
            position.y >= viewport.y + padding &&
            position.x + position.width <= viewport.x + viewport.width - padding &&
            position.y + position.height <= viewport.y + viewport.height - padding &&
            !occupied.overlaps(position),
        );
    if (!placement) continue;

    accepted.push(placement);
    occupied.add(placement);
  }

  return accepted;
}

export function createPillCacheKey(text: string, font: string, fontGeneration: number): string {
  return `${fontGeneration}\u0000${font}\u0000${text}`;
}

export class GraphOverlayLayer extends Entity {
  private viewport: GraphViewport;
  private hoveredEntity: GraphNode2D | null = null;
  private pulsePhase = 0;
  private ripplePhase = 0;
  private nodeBadges: NodeScreenBadge[] = [];
  private badgePool: NodeScreenBadge[] = [];
  private pillCache = new Map<string, CachedPillInfo>();
  private fontGeneration = 0;
  private activeFilters: ReadonlySet<string> | null = null;
  private activePredicates: ReadonlySet<string> | null = null;

  constructor(viewport: GraphViewport) {
    super();
    this.id = 'graph-overlay-layer';
    this.interactive = false;
    this.viewport = viewport;
    if (typeof document !== 'undefined' && document.fonts) {
      void document.fonts.ready.then(() => {
        this.fontGeneration++;
        this.pillCache.clear();
        this.scene?.markDirty();
      });
    }
  }

  isPointInside(_x: number, _y: number): boolean {
    return false;
  }

  hasPendingAnimations(): boolean {
    return this.viewport.isPhysicsActive() || this.viewport.isCameraAnimating();
  }

  setActiveFilter(filters: ReadonlySet<string> | readonly string[] | string | null): void {
    const values = typeof filters === 'string' ? [filters] : filters ? [...filters] : [];
    this.activeFilters = values.length ? new Set(values) : null;
    this.scene.markDirty();
  }

  setActivePredicates(predicates: ReadonlySet<string> | null): void {
    this.activePredicates = predicates;
    this.scene.markDirty();
  }

  setHoveredEntity(e: GraphNode2D | null): void {
    if (this.hoveredEntity === e) return;
    this.hoveredEntity = e;
    this.scene.markDirty();
  }

  getNodeAtScreenPoint(x: number, y: number): GraphNode2D | null {
    if (this.viewport.getNodes().length === 0) return null;
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

  clearInteractionState(): void {
    this.hoveredEntity = null;
    this.nodeBadges = [];
    this.badgePool = [];
    this.pillCache.clear();
    this.scene?.markDirty();
  }

  private getCachedPill(ctx: CanvasRenderingContext2D, e: GraphNode2D): CachedPillInfo {
    const id = String(e.id);
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
    const font = isAuthor ? `700 12px ${Theme.fonts.serif}` : `600 11px ${Theme.fonts.sans}`;
    const cacheKey = createPillCacheKey(
      `${id}\u0000${displayText}\u0000${e.color ?? ''}`,
      font,
      this.fontGeneration,
    );
    const cached = this.pillCache.get(cacheKey);
    if (cached) return cached;

    ctx.font = font;
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
      font,
    };
    this.pillCache.set(cacheKey, info);
    return info;
  }

  render(r: any): void {
    const ctx = getCanvasCtx(r);
    ctx.save();
    try {
      this.renderFrame(ctx);
    } finally {
      ctx.restore();
    }
  }

  private renderFrame(ctx: CanvasRenderingContext2D): void {
    this.viewport.update();

    const nodes = this.viewport.getNodes();
    const anyLoading = nodes.some((node) => this.viewport.isNodeLoading(node.id));
    // Ambient ripple only pulses while the graph is visibly alive (physics or
    // camera motion) or a page fetch is in flight; at rest it resets so a
    // half-expanded ring never freezes.
    if (this.viewport.isPhysicsActive() || this.viewport.isCameraAnimating() || anyLoading) {
      this.pulsePhase += 0.06;
      this.ripplePhase = (this.ripplePhase + 0.03) % 1;
    } else {
      this.ripplePhase = 0;
    }
    this.nodeBadges.length = 0;
    if (nodes.length === 0) return;

    const w = this.scene.width;
    const h = this.scene.height;
    const nodeCount = nodes.length;
    let badgeIndex = 0;

    // 1. Calculate Screen Coordinates inline to avoid allocations
    for (let i = 0; i < nodeCount; i++) {
      const node = nodes[i]!;
      const nx = node.x ?? 0;
      const ny = node.y ?? 0;
      const sc = this.viewport.worldToScreen(nx, ny);
      node.sx = sc.x;
      node.sy = sc.y;
    }

    // 1b. Pulsing halo for nodes with in-flight page fetches
    for (let i = 0; i < nodeCount; i++) {
      const node = nodes[i]!;
      if (!this.viewport.isNodeLoading(node.id)) continue;
      if (node.sx === undefined || node.sy === undefined) continue;
      const pulse = (Math.sin(this.pulsePhase * 4) + 1) / 2;
      ctx.strokeStyle = `rgba(255, 217, 142, ${(0.35 + pulse * 0.4).toFixed(3)})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(node.sx, node.sy, (node.radius ?? 8) + 10 + pulse * 5, 0, Math.PI * 2);
      ctx.stroke();
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
      if (this.activePredicates && !this.activePredicates.has(link.predicate)) continue;
      const srcId = typeof link.source === 'object' ? link.source.id : link.source;
      const tgtId = typeof link.target === 'object' ? link.target.id : link.target;

      const src = this.viewport.graph.getNode(srcId);
      const tgt = this.viewport.graph.getNode(tgtId);
      if (
        !src ||
        !tgt ||
        src.sx === undefined ||
        src.sy === undefined ||
        tgt.sx === undefined ||
        tgt.sy === undefined
      )
        continue;

      // Skip offscreen links
      if (
        (src.sx < -100 && tgt.sx < -100) ||
        (src.sx > w + 100 && tgt.sx > w + 100) ||
        (src.sy < -100 && tgt.sy < -100) ||
        (src.sy > h + 100 && tgt.sy > h + 100)
      ) {
        continue;
      }

      const isHl = hlEdges.has(`${srcId}->${tgtId}`) || hlEdges.has(`${tgtId}->${srcId}`);
      const isHoverConn = hoveredId && (srcId === hoveredId || tgtId === hoveredId);

      if (isHl || isHoverConn) {
        specialLinks.push({
          src: { x: src.sx!, y: src.sy! },
          tgt: { x: tgt.sx!, y: tgt.sy! },
          isHl: Boolean(isHl),
        });
      } else {
        ctx.moveTo(src.sx!, src.sy!);
        ctx.lineTo(tgt.sx!, tgt.sy!);
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

      if (
        node.sx === undefined ||
        node.sx < -50 ||
        node.sx > w + 50 ||
        node.sy === undefined ||
        node.sy < 64 ||
        node.sy > h + 50
      )
        continue;

      ctx.moveTo(node.sx + rippleR, node.sy);
      ctx.arc(node.sx, node.sy, rippleR, 0, Math.PI * 2);
    }
    ctx.stroke();

    // 4. Batched Draw Node Beads & Category Glows
    // Group nodes by color to eliminate thousands of canvas state changes
    const nodesByColor = new Map<string, GraphNode2D[]>();
    for (let i = 0; i < nodeCount; i++) {
      const node = nodes[i]!;
      if (
        node.sx === undefined ||
        node.sx < -100 ||
        node.sx > w + 100 ||
        node.sy === undefined ||
        node.sy < 64 ||
        node.sy > h + 50
      )
        continue;
      const color = node.color || Theme.getNodeColor(node.type);
      let list = nodesByColor.get(color);
      if (!list) {
        list = [];
        nodesByColor.set(color, list);
      }
      list.push(node);
    }

    // Pass 4.1: Outer Glows (Batched by color)
    ctx.globalAlpha = 0.32;
    for (const [color, colorNodes] of nodesByColor.entries()) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (const node of colorNodes) {
        const isHovered = this.hoveredEntity && this.hoveredEntity.id === node.id;
        const baseR =
          (node.radius || (node.type === 'author' ? 12 : 7)) *
          Math.min(1.3, Math.max(0.65, this.viewport.zoom));
        const r = isHovered ? baseR * 1.35 : baseR;
        ctx.moveTo((node.sx ?? 0) + r + (isHovered ? 6 : 3.5), node.sy ?? 0);
        ctx.arc(node.sx ?? 0, node.sy ?? 0, r + (isHovered ? 6 : 3.5), 0, Math.PI * 2);
      }
      ctx.fill();
    }

    // Pass 4.2: Inner Beads (Batched by color)
    ctx.globalAlpha = 1.0;
    for (const [color, colorNodes] of nodesByColor.entries()) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (const node of colorNodes) {
        const isHovered = this.hoveredEntity && this.hoveredEntity.id === node.id;
        if (isHovered) continue; // Draw hovered later
        const r =
          (node.radius || (node.type === 'author' ? 12 : 7)) *
          Math.min(1.3, Math.max(0.65, this.viewport.zoom));
        ctx.moveTo((node.sx ?? 0) + r, node.sy ?? 0);
        ctx.arc(node.sx ?? 0, node.sy ?? 0, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    // Draw Hovered Inner Bead in White
    if (this.hoveredEntity && this.hoveredEntity.sx !== undefined) {
      const node = this.hoveredEntity;
      const r =
        (node.radius || (node.type === 'author' ? 12 : 7)) *
        Math.min(1.3, Math.max(0.65, this.viewport.zoom)) *
        1.35;
      ctx.fillStyle = '#FFFDF9';
      ctx.beginPath();
      ctx.arc(node.sx!, node.sy ?? 0, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Pass 4.3: Batched Borders
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < nodeCount; i++) {
      const node = nodes[i]!;
      if (
        node.sx === undefined ||
        node.sx < -100 ||
        node.sx > w + 100 ||
        node.sy === undefined ||
        node.sy < 64 ||
        node.sy > h + 50
      )
        continue;
      const isHovered = this.hoveredEntity && this.hoveredEntity.id === node.id;
      if (isHovered) continue;
      const r =
        (node.radius || (node.type === 'author' ? 12 : 7)) *
        Math.min(1.3, Math.max(0.65, this.viewport.zoom));
      ctx.moveTo(node.sx + r, node.sy);
      ctx.arc(node.sx, node.sy, r, 0, Math.PI * 2);
    }
    ctx.stroke();

    if (this.hoveredEntity && this.hoveredEntity.sx !== undefined) {
      const node = this.hoveredEntity;
      const r =
        (node.radius || (node.type === 'author' ? 12 : 7)) *
        Math.min(1.3, Math.max(0.65, this.viewport.zoom)) *
        1.35;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(node.sx!, node.sy ?? 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 5. Place labels in screen space, highest priority first.
    let hoveredData: { entity: GraphNode2D; sx: number; sy: number } | null = null;
    const highlightNodes = this.viewport.getHighlightNodes();
    const graphRect = this.viewport.getGraphScreenRect();
    const requiresLod = this.viewport.zoom < 0.7 || nodeCount > 60;
    const labelBudget = requiresLod
      ? Math.max(
          4,
          Math.floor(
            ((graphRect.w * graphRect.h) / 12_000) *
              Math.min(1, Math.max(0.35, this.viewport.zoom)),
          ),
        )
      : nodeCount;
    const visibleNodes: {
      node: GraphNode2D;
      sx: number;
      sy: number;
      radius: number;
      hovered: boolean;
      onPath: boolean;
    }[] = [];
    const labelCandidates: LabelPlacementCandidate[] = [];
    const labelData = new Map<string, { node: GraphNode2D; pillInfo: CachedPillInfo }>();
    for (let i = 0; i < nodeCount; i++) {
      const node = nodes[i]!;
      if (
        node.sx === undefined ||
        node.sx < -100 ||
        node.sx > w + 100 ||
        node.sy === undefined ||
        node.sy < 64 ||
        node.sy > h + 50
      )
        continue;

      const isHovered = this.hoveredEntity && this.hoveredEntity.id === node.id;
      if (isHovered) {
        hoveredData = { entity: node, sx: node.sx, sy: node.sy };
      }

      const matchesFilter = !this.activeFilters || this.activeFilters.has(node.type);
      if (!matchesFilter && !isHovered) continue;

      const nodeR =
        (node.radius || (node.type === 'author' ? 12 : 7)) *
        Math.min(1.3, Math.max(0.65, this.viewport.zoom));
      visibleNodes.push({
        node,
        sx: node.sx,
        sy: node.sy,
        radius: nodeR,
        hovered: Boolean(isHovered),
        onPath: highlightNodes.has(String(node.id)),
      });
    }

    const measuredNodes = requiresLod
      ? [...visibleNodes]
          .sort((a, b) => {
            const priority =
              Number(b.hovered) - Number(a.hovered) || Number(b.onPath) - Number(a.onPath);
            return (
              priority ||
              (b.node.degree ?? 0) - (a.node.degree ?? 0) ||
              a.node.id.localeCompare(b.node.id)
            );
          })
          .slice(0, Math.min(visibleNodes.length, Math.max(labelBudget * 4, labelBudget + 8)))
      : visibleNodes;
    for (const visible of measuredNodes) {
      const { node, sx, sy, radius, hovered, onPath } = visible;
      const pillInfo = this.getCachedPill(ctx, node);
      labelCandidates.push({
        id: String(node.id),
        sx,
        sy,
        width: pillInfo.pillW,
        height: pillInfo.pillH,
        radius,
        hovered,
        onPath,
        degree: node.degree ?? 0,
      });
      labelData.set(String(node.id), { node, pillInfo });
    }

    const placements = placeGraphLabels(labelCandidates, {
      viewport: { x: graphRect.x, y: graphRect.y, width: graphRect.w, height: graphRect.h },
      maxLabels: labelBudget,
      stable: this.viewport.isPhysicsActive(),
      occupied: [
        { x: 0, y: Math.max(graphRect.y, h - 160), width: 215, height: 160 },
        { x: Math.max(0, w - 180), y: Math.max(graphRect.y, h - 100), width: 180, height: 100 },
        ...visibleNodes.map((visible) => ({
          x: visible.sx - visible.radius,
          y: visible.sy - visible.radius,
          width: visible.radius * 2,
          height: visible.radius * 2,
        })),
      ],
    });

    for (const placement of placements) {
      const data = labelData.get(placement.id);
      if (!data) continue;
      const { node, pillInfo } = data;
      const isHovered = this.hoveredEntity?.id === node.id;
      const pillX = placement.x;
      const pillY = placement.y;

      let badge = this.badgePool[badgeIndex];
      if (!badge) {
        badge = {
          id: node.id,
          entity: node,
          sx: node.sx!,
          sy: node.sy!,
          pillX,
          pillY,
          pillW: placement.width,
          pillH: placement.height,
        };
        this.badgePool[badgeIndex] = badge;
      } else {
        badge.id = node.id;
        badge.entity = node;
        badge.sx = node.sx!;
        badge.sy = node.sy!;
        badge.pillX = pillX;
        badge.pillY = pillY;
        badge.pillW = placement.width;
        badge.pillH = placement.height;
      }
      this.nodeBadges.push(badge);
      badgeIndex++;

      ctx.fillStyle = isHovered
        ? 'rgba(64, 51, 42, 0.98)'
        : pillInfo.isAuthor
          ? 'rgba(40, 31, 25, 0.94)'
          : 'rgba(32, 25, 20, 0.88)';
      ctx.beginPath();
      ctx.roundRect(pillX, pillY, placement.width, placement.height, 5);
      ctx.fill();

      ctx.strokeStyle = isHovered
        ? '#FFE066'
        : pillInfo.isAuthor
          ? Theme.colors.borderHighlight
          : Theme.colors.border;
      ctx.lineWidth = isHovered ? 1.5 : 1;
      ctx.stroke();

      ctx.fillStyle = pillInfo.typeColor;
      ctx.beginPath();
      ctx.roundRect(pillX + 3, pillY + 3, 3, placement.height - 6, 2);
      ctx.fill();

      ctx.font = pillInfo.font;
      ctx.fillStyle = isHovered ? '#FFFDF9' : Theme.colors.textHigh;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        pillInfo.displayText,
        pillX + placement.width / 2 + 2,
        pillY + placement.height / 2,
      );
    }

    // 6. Draw Hovered Entity Tooltip Card
    if (hoveredData) {
      this.renderHoverCard(ctx, hoveredData.entity, hoveredData.sx, hoveredData.sy, w, h);
    }

    // Self-sustain the render loop while physics or the camera are animating;
    // when both settle the on-demand scene goes to sleep.
    if (this.hasPendingAnimations()) {
      this.scene.markDirty();
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

    // Title (truncated to the card width)
    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `700 13px ${Theme.fonts.serif}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const maxNameW = cardW - 68;
    let displayName = node.name;
    if (ctx.measureText(displayName).width > maxNameW) {
      let cut = displayName;
      while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxNameW) {
        cut = cut.slice(0, -1);
      }
      displayName = `${cut}…`;
    }
    ctx.fillText(displayName, cardX + 58, cardY + 18);

    // Action Hint
    ctx.fillStyle = Theme.colors.textLow;
    ctx.font = `500 10px ${Theme.fonts.sans}`;
    ctx.fillText('💡 点击展开邻域与侦探档案', cardX + 10, cardY + 46);

    ctx.restore();
  }
}
