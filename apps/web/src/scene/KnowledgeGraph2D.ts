import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
} from 'd3-force';
import type { D1DataSource } from '../api/D1DataSource';
import type { GraphLink2D, GraphNode2D } from './types';

export interface KnowledgeGraph2DOptions {
  source: D1DataSource;
  onUpdate?: () => void;
}

export class KnowledgeGraph2D {
  private source: D1DataSource;
  private nodesMap = new Map<string, GraphNode2D>();
  private nodesList: GraphNode2D[] = [];
  private linksList: GraphLink2D[] = [];
  private factKeySet = new Set<string>();
  private expandedSet = new Set<string>();

  private simulation: Simulation<GraphNode2D, any> | null = null;
  private onUpdateCb?: () => void;

  constructor(options: KnowledgeGraph2DOptions) {
    this.source = options.source;
    this.onUpdateCb = options.onUpdate;
  }

  get nodes(): readonly GraphNode2D[] {
    return this.nodesList;
  }

  get links(): readonly GraphLink2D[] {
    return this.linksList;
  }

  get nodeCount(): number {
    return this.nodesList.length;
  }

  getNode(id: string): GraphNode2D | undefined {
    return this.nodesMap.get(id);
  }

  isExpanded(id: string): boolean {
    return this.expandedSet.has(id);
  }

  async bootstrap(seedNodes: GraphNode2D[]): Promise<void> {
    this.nodesMap.clear();
    this.nodesList = [];
    this.linksList = [];
    this.factKeySet.clear();
    this.expandedSet.clear();

    const count = seedNodes.length;
    for (let i = 0; i < count; i++) {
      const node = seedNodes[i]!;
      // Arrange initial seeds in a harmonious golden spiral
      const angle = i * 2.39996; // Golden angle
      const r = 40 + Math.sqrt(i) * 60;
      node.x = Math.cos(angle) * r;
      node.y = Math.sin(angle) * r;
      node.vx = 0;
      node.vy = 0;
      this.nodesMap.set(node.id, node);
      this.nodesList.push(node);
    }

    this.rebuildSimulation();
  }

  async expand(nodeId: string): Promise<number> {
    if (this.expandedSet.has(nodeId)) return 0;
    this.expandedSet.add(nodeId);

    const centerNode = this.nodesMap.get(nodeId);
    const cx = centerNode?.x ?? 0;
    const cy = centerNode?.y ?? 0;

    const neighborhood = await this.source.getNeighbors(nodeId);
    let addedCount = 0;

    // 1. Ingest Neighbors
    const nLen = neighborhood.neighbors.length;
    for (let i = 0; i < nLen; i++) {
      const neighbor = neighborhood.neighbors[i]!;
      if (!this.nodesMap.has(neighbor.id)) {
        // Spawn near the parent node with subtle outward offset
        const angle = (i / Math.max(1, nLen)) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
        const dist = 50 + Math.random() * 40;
        neighbor.x = cx + Math.cos(angle) * dist;
        neighbor.y = cy + Math.sin(angle) * dist;
        neighbor.vx = (Math.random() - 0.5) * 2;
        neighbor.vy = (Math.random() - 0.5) * 2;

        this.nodesMap.set(neighbor.id, neighbor);
        this.nodesList.push(neighbor);
        addedCount++;
      }
    }

    // 2. Ingest Relational Facts
    for (const f of neighborhood.facts) {
      const srcId = typeof f.source === 'object' ? f.source.id : f.source;
      const tgtId = typeof f.target === 'object' ? f.target.id : f.target;
      const key = `${srcId}|${f.predicate}|${tgtId}`;
      if (!this.factKeySet.has(key)) {
        this.factKeySet.add(key);
        this.linksList.push({
          source: srcId,
          target: tgtId,
          predicate: f.predicate,
        });
      }
    }

    if (addedCount > 0) {
      this.rebuildSimulation();
      this.reheat(0.7);
    }

    return addedCount;
  }

  private rebuildSimulation(): void {
    if (this.simulation) {
      this.simulation.stop();
    }

    // Map links to node objects or string IDs
    const simLinks = this.linksList.map((link) => ({
      source: typeof link.source === 'object' ? link.source.id : link.source,
      target: typeof link.target === 'object' ? link.target.id : link.target,
      predicate: link.predicate,
    }));

    this.simulation = forceSimulation(this.nodesList)
      .force(
        'link',
        forceLink(simLinks)
          .id((d: any) => d.id)
          .distance((d: any) => {
            const src = d.source as GraphNode2D;
            const tgt = d.target as GraphNode2D;
            if (src.type === 'author' && tgt.type === 'work') return 55;
            if (src.type === 'author' && tgt.type === 'character') return 60;
            return 75;
          })
          .strength(0.35),
      )
      .force('charge', forceManyBody().strength(-180).distanceMax(500))
      .force('center', forceCenter(0, 0).strength(0.015))
      .force(
        'collide',
        forceCollide().radius((d: any) => (d.type === 'author' ? 32 : 24)),
      )
      .alphaDecay(0.022)
      .velocityDecay(0.4)
      .on('tick', () => {
        this.onUpdateCb?.();
      });
  }

  reheat(alpha = 0.5): void {
    if (this.simulation) {
      this.simulation.alpha(alpha).restart();
    }
  }

  pinNode(id: string, x: number, y: number): void {
    const node = this.nodesMap.get(id);
    if (node) {
      node.fx = x;
      node.fy = y;
      node.x = x;
      node.y = y;
      this.reheat(0.15);
    }
  }

  unpinNode(id: string): void {
    const node = this.nodesMap.get(id);
    if (node) {
      node.fx = null;
      node.fy = null;
    }
  }

  findNodeAt(worldX: number, worldY: number, hitRadius = 28): GraphNode2D | null {
    let closest: GraphNode2D | null = null;
    let minSq = hitRadius * hitRadius;

    for (const node of this.nodesList) {
      const nx = node.x ?? 0;
      const ny = node.y ?? 0;
      const dx = nx - worldX;
      const dy = ny - worldY;
      const distSq = dx * dx + dy * dy;
      if (distSq < minSq) {
        minSq = distSq;
        closest = node;
      }
    }

    return closest;
  }

  getBoundingBox(): { minX: number; minY: number; maxX: number; maxY: number } {
    if (this.nodesList.length === 0) {
      return { minX: -200, minY: -200, maxX: 200, maxY: 200 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const node of this.nodesList) {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    return { minX, minY, maxX, maxY };
  }

  dispose(): void {
    this.simulation?.stop();
    this.simulation = null;
    this.nodesMap.clear();
    this.nodesList = [];
    this.linksList = [];
  }
}
