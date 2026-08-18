import type { D1DataSource } from '../api/D1DataSource';
import { KnowledgeGraph2D } from './KnowledgeGraph2D';
import type { GraphLink2D, GraphNode2D } from './types';
import type { NodeStyleSettings } from '../node-style-settings';
import type { KnowledgeGraphSnapshot } from './KnowledgeGraph2D';

export interface GraphViewportOptions {
  source: D1DataSource;
  onChange: () => void;
  onSelectNode: (node: GraphNode2D | null) => void;
  onHoverNode: (node: GraphNode2D | null) => void;
  styleSettings?: NodeStyleSettings;
}

export class GraphViewport {
  readonly graph: KnowledgeGraph2D;
  private onSelectCb: (node: GraphNode2D | null) => void;
  private onHoverCb: (node: GraphNode2D | null) => void;
  private onChange: () => void;

  // 2D Camera / Viewport Transform
  public panX = 0;
  public panY = 0;
  public zoom = 1.0;
  public width = 1200;
  public height = 800;

  // Path Highlighting
  private activeHighlightNodes = new Set<string>();
  private activeHighlightEdges = new Set<string>();

  // Smooth Camera Animation
  private targetPanX = 0;
  private targetPanY = 0;
  private targetZoom = 1.0;
  private cameraAnimating = false;
  private animStartTime = 0;
  private animDuration = 400;
  private startPanX = 0;
  private startPanY = 0;
  private startZoom = 1.0;

  constructor(options: GraphViewportOptions) {
    this.onSelectCb = options.onSelectNode;
    this.onHoverCb = options.onHoverNode;
    this.onChange = options.onChange;

    this.graph = new KnowledgeGraph2D({
      source: options.source,
      styleSettings: options.styleSettings,
      onChange: () => this.onChange(),
    });
  }

  applyStyleSettings(settings: NodeStyleSettings): void {
    this.graph.applyStyleSettings(settings);
    this.onChange();
  }

  exportSnapshot(): KnowledgeGraphSnapshot {
    return this.graph.exportSnapshot();
  }
  importSnapshot(snapshot: KnowledgeGraphSnapshot): void {
    this.graph.importSnapshot(snapshot);
    this.onChange();
  }
  setCamera(camera: { panX: number; panY: number; zoom: number }): void {
    this.cameraAnimating = false;
    this.panX = camera.panX;
    this.panY = camera.panY;
    this.zoom = Math.max(0.15, Math.min(3.5, camera.zoom));
    this.onChange();
  }

  async init(seedIds?: string[]): Promise<void> {
    const generation = this.graph.getGeneration();
    const seedNodes = await this.graph['source'].getNodes(seedIds);
    if (generation !== this.graph.getGeneration()) return;
    await this.graph.bootstrap(seedNodes as GraphNode2D[]);

    // Center camera on origin
    this.panX = this.width / 2;
    this.panY = this.height / 2;
    this.zoom = 1.0;

    // Asynchronously expand top 3 master authors in parallel for rich starting connections
    const topMasters = seedNodes.slice(0, 3).map((s) => s.id);
    setTimeout(() => {
      if (generation !== this.graph.getGeneration()) return;
      Promise.all(topMasters.map((id) => this.graph.expand(id)))
        .then(() => {
          this.fitToView();
        })
        .catch(() => {});
    }, 120);
  }

  clear(): void {
    this.graph.clear();
    this.activeHighlightNodes.clear();
    this.activeHighlightEdges.clear();
    this.cameraAnimating = false;
    this.panX = this.width / 2;
    this.panY = this.height / 2;
    this.zoom = 1;
    this.onChange();
  }

  resize(w: number, h: number): void {
    if (this.width === 0 || this.height === 0) {
      this.panX = w / 2;
      this.panY = h / 2;
    } else {
      // Keep center invariant on resize
      this.panX += (w - this.width) / 2;
      this.panY += (h - this.height) / 2;
    }
    this.width = w;
    this.height = h;
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    return {
      x: x * this.zoom + this.panX,
      y: y * this.zoom + this.panY,
    };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.panX) / this.zoom,
      y: (sy - this.panY) / this.zoom,
    };
  }

  getGraphScreenRect(): { x: number; y: number; w: number; h: number } {
    return { x: 0, y: 64, w: this.width, h: Math.max(0, this.height - 64) };
  }

  centerWorldAt(x: number, y: number): void {
    const graphRect = this.getGraphScreenRect();
    this.animateCameraTo(
      graphRect.x + graphRect.w / 2 - x * this.zoom,
      graphRect.y + graphRect.h / 2 - y * this.zoom,
      this.zoom,
      350,
    );
  }

  pan(dx: number, dy: number): void {
    this.cameraAnimating = false;
    this.panX += dx;
    this.panY += dy;
    this.onChange();
  }

  zoomAt(factor: number, clientX: number, clientY: number): void {
    this.cameraAnimating = false;
    const newZoom = Math.min(Math.max(this.zoom * factor, 0.15), 3.5);
    if (newZoom === this.zoom) return;

    this.panX = clientX - (clientX - this.panX) * (newZoom / this.zoom);
    this.panY = clientY - (clientY - this.panY) * (newZoom / this.zoom);
    this.zoom = newZoom;
    this.onChange();
  }

  fitToView(): void {
    const bb = this.graph.getBoundingBox();
    const graphW = Math.max(bb.maxX - bb.minX, 200);
    const graphH = Math.max(bb.maxY - bb.minY, 200);
    const cx = (bb.minX + bb.maxX) / 2;
    const cy = (bb.minY + bb.maxY) / 2;

    const availableW = this.width - 160;
    const availableH = this.height - 180;
    const scale = Math.min(availableW / graphW, availableH / graphH, 1.2);
    const targetZoom = Math.max(scale, 0.35);

    const targetPanX = this.width / 2 - cx * targetZoom;
    const targetPanY = this.height / 2 + 20 - cy * targetZoom;

    this.animateCameraTo(targetPanX, targetPanY, targetZoom, 500);
  }

  resetZoom(): void {
    this.fitToView();
  }

  private isFrozen = false;

  freeze(frozen: boolean): void {
    this.isFrozen = frozen;
    if (!frozen) {
      this.graph.reheat(0.3);
    }
    this.onChange();
  }

  isPhysicsFrozen(): boolean {
    return this.isFrozen;
  }

  isCameraAnimating(): boolean {
    return this.cameraAnimating;
  }

  isPhysicsActive(): boolean {
    return !this.isFrozen && this.graph.isSimulating();
  }

  wakeUp(): void {
    this.graph.reheat(0.4);
  }

  focusNode(id: string): void {
    const node = this.graph.getNode(id);
    if (!node) return;

    const targetX = node.x ?? 0;
    const targetY = node.y ?? 0;
    const targetZoom = Math.max(this.zoom, 1.1);

    // Offset slightly to the left so drawer doesn't occlude the node on desktop
    const screenTargetX = this.width < 768 ? this.width / 2 : this.width * 0.38;
    const screenTargetY = this.height / 2 + 20;

    const targetPanX = screenTargetX - targetX * targetZoom;
    const targetPanY = screenTargetY - targetY * targetZoom;

    this.animateCameraTo(targetPanX, targetPanY, targetZoom, 450);
  }

  ensureNodeVisible(id: string, margin = 80): void {
    const node = this.graph.getNode(id);
    if (!node) return;
    const screen = this.worldToScreen(node.x ?? 0, node.y ?? 0);
    if (
      screen.x >= margin &&
      screen.x <= this.width - margin &&
      screen.y >= 64 + margin &&
      screen.y <= this.height - margin
    ) {
      this.onChange();
      return;
    }
    this.focusNode(id);
  }

  addManualNode(node: GraphNode2D): boolean {
    const world = this.screenToWorld(this.width / 2, this.height / 2);
    const hash = [...node.id].reduce(
      (value, char) => (value * 33 + char.charCodeAt(0)) >>> 0,
      5381,
    );
    const angle = (hash % 360) * (Math.PI / 180);
    const distance = 24 + (hash % 28);
    const added = this.graph.addManualNode(
      node,
      world.x + Math.cos(angle) * distance,
      world.y + Math.sin(angle) * distance,
    );
    if (added) this.onChange();
    return added;
  }

  addPathNodes(nodes: GraphNode2D[], edges: GraphLink2D[]): void {
    this.graph.addPath(nodes, edges);
    this.fitToView();
    this.onChange();
  }

  // Fling gesture: keep panning after the pointer is released with
  // exponential velocity decay (v = v0 * e^(-t/tau)). The ease-out cubic
  // animation is matched so its initial velocity equals v0.
  inertiaPan(vx: number, vy: number): void {
    const speed = Math.hypot(vx, vy);
    if (speed < 0.12) return;
    const tau = 170;
    const duration = Math.min(3 * tau, 900);
    const maxDist = 900;
    const dist = Math.min(speed * tau, maxDist);
    const scale = dist / Math.max(speed * tau, 0.001);
    const dx = vx * tau * scale;
    const dy = vy * tau * scale;
    this.animateCameraTo(this.panX + dx, this.panY + dy, this.zoom, duration);
  }

  private animateCameraTo(
    targetPanX: number,
    targetPanY: number,
    targetZoom: number,
    duration = 400,
  ): void {
    this.startPanX = this.panX;
    this.startPanY = this.panY;
    this.startZoom = this.zoom;
    this.targetPanX = targetPanX;
    this.targetPanY = targetPanY;
    this.targetZoom = targetZoom;
    this.animDuration = duration;
    this.animStartTime = performance.now();
    this.cameraAnimating = true;
    this.onChange();
  }

  update(): void {
    if (!this.isFrozen) {
      this.graph.step();
    }

    if (this.cameraAnimating) {
      const now = performance.now();
      const elapsed = now - this.animStartTime;
      const t = Math.min(1, elapsed / this.animDuration);
      // Cubic ease-out
      const ease = 1 - Math.pow(1 - t, 3);

      this.panX = this.startPanX + (this.targetPanX - this.startPanX) * ease;
      this.panY = this.startPanY + (this.targetPanY - this.startPanY) * ease;
      this.zoom = this.startZoom + (this.targetZoom - this.startZoom) * ease;

      if (t >= 1) {
        this.cameraAnimating = false;
      }
    }
  }

  async expandNode(id: string): Promise<number> {
    const count = await this.graph.expand(id);
    this.onChange();
    return count;
  }

  async toggleNodeExpansion(id: string, predicates?: readonly string[]): Promise<number> {
    const count = await this.graph.toggleExpansion(id, predicates);
    this.onChange();
    return count;
  }

  isNodeExpanded(id: string): boolean {
    return this.graph.isExpanded(id);
  }

  canLoadMore(id: string): boolean {
    return this.graph.canLoadMore(id);
  }

  isNodeLoading(id: string): boolean {
    return this.graph.isNodeLoading(id);
  }

  getExpansionProgress(id: string): { loaded: number; total?: number } {
    return this.graph.getExpansionProgress(id);
  }

  whenExpansionIdle(id: string): Promise<void> {
    return this.graph.whenExpansionIdle(id);
  }

  setHoverPinned(id: string | null): void {
    this.graph.setHoverPinned(id);
  }

  clearHoverPin(): void {
    this.graph.clearHoverPin();
  }

  beginNodeDrag(id: string): boolean {
    const started = this.graph.beginNodeDrag(id);
    if (started) this.onChange();
    return started;
  }

  updateNodeDrag(id: string, x: number, y: number): boolean {
    const updated = this.graph.updateNodeDrag(id, x, y);
    if (updated) this.onChange();
    return updated;
  }

  endNodeDrag(id: string): boolean {
    const ended = this.graph.endNodeDrag(id);
    if (ended) this.onChange();
    return ended;
  }

  cancelNodeDrag(id: string): boolean {
    const cancelled = this.graph.cancelNodeDrag(id);
    if (cancelled) this.onChange();
    return cancelled;
  }

  collapseNode(id: string): void {
    this.graph.collapse(id);
    this.onChange();
  }

  async expandBounded(startId: string, maxDepth = 2, maxNewNodes = 80): Promise<number> {
    let expanded = 0;
    let frontier = [startId];
    const visited = new Set<string>();
    const initialCount = this.graph.nodeCount;

    for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
      const next: string[] = [];
      for (const id of frontier) {
        if (visited.has(id) || this.graph.isExpanded(id)) {
          next.push(...this.graph.getAdjacentIds(id));
          visited.add(id);
          continue;
        }
        visited.add(id);
        const remaining = maxNewNodes - (this.graph.nodeCount - initialCount);
        await this.graph.expand(id, Math.max(1, Math.min(50, remaining)), undefined, {
          chase: true,
        });
        expanded++;
        if (this.graph.nodeCount - initialCount >= maxNewNodes) break;
        next.push(...this.graph.getAdjacentIds(id));
      }
      frontier = [...new Set(next)].filter((id) => !visited.has(id));
      if (this.graph.nodeCount - initialCount >= maxNewNodes) break;
    }
    this.onChange();
    return expanded;
  }

  toggleNodePinned(id: string): boolean {
    const pinned = this.graph.togglePinned(id);
    this.onChange();
    return pinned;
  }

  isNodePinned(id: string): boolean {
    return this.graph.isPinned(id);
  }

  relayoutAround(id: string): number {
    const moved = this.graph.relayoutAround(id);
    if (moved) this.onChange();
    return moved;
  }

  hideNode(id: string): boolean {
    const hidden = this.graph.hideNode(id);
    if (hidden) this.onChange();
    return hidden;
  }

  getHiddenNodes(): readonly GraphNode2D[] {
    return this.graph.getHiddenNodes();
  }

  restoreNode(id: string): boolean {
    const restored = this.graph.restoreNode(id);
    if (restored) this.onChange();
    return restored;
  }

  restoreAllHidden(): number {
    const restored = this.graph.restoreAllHidden();
    if (restored) this.onChange();
    return restored;
  }

  highlightPath(nodeIds: string[], edges: { source: string; target: string }[]): void {
    this.activeHighlightNodes.clear();
    for (const nid of nodeIds) {
      this.activeHighlightNodes.add(nid);
    }

    this.activeHighlightEdges.clear();
    for (const e of edges) {
      this.activeHighlightEdges.add(`${e.source}->${e.target}`);
      this.activeHighlightEdges.add(`${e.target}->${e.source}`);
    }
    this.onChange();
  }

  clearHighlight(): void {
    this.activeHighlightNodes.clear();
    this.activeHighlightEdges.clear();
    this.onChange();
  }

  getNodes(): readonly GraphNode2D[] {
    return this.graph.nodes;
  }

  getLinks(): readonly GraphLink2D[] {
    return this.graph.links;
  }

  getHighlightNodes(): ReadonlySet<string> {
    return this.activeHighlightNodes;
  }

  getHighlightEdges(): ReadonlySet<string> {
    return this.activeHighlightEdges;
  }

  selectNode(node: GraphNode2D | null): void {
    this.onSelectCb(node);
  }

  hoverNode(node: GraphNode2D | null): void {
    this.onHoverCb(node);
  }

  dispose(): void {
    this.graph.dispose();
  }
}
