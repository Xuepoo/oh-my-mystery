import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  type Simulation,
} from 'd3-force';
import type { D1DataSource } from '../api/D1DataSource';
import type { GraphLink2D, GraphNode2D } from './types';

export interface KnowledgeGraph2DOptions {
  source: D1DataSource;
}

export class KnowledgeGraph2D {
  private source: D1DataSource;
  private nodesMap = new Map<string, GraphNode2D>();
  private nodesList: GraphNode2D[] = [];
  private linksList: GraphLink2D[] = [];
  private factKeySet = new Set<string>();
  private expandedSet = new Set<string>();

  private simulation: Simulation<GraphNode2D, any> | null = null;

  constructor(options: KnowledgeGraph2DOptions) {
    this.source = options.source;
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
      const r = 35 + Math.sqrt(i) * 55;
      node.x = Math.cos(angle) * r;
      node.y = Math.sin(angle) * r;
      node.vx = 0;
      node.vy = 0;
      node.degree = 0;
      node.radius = node.type === 'author' ? 12 : 8;
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
        const angle = (i / Math.max(1, nLen)) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
        const dist = 45 + Math.random() * 35;
        neighbor.x = cx + Math.cos(angle) * dist;
        neighbor.y = cy + Math.sin(angle) * dist;
        neighbor.vx = (Math.random() - 0.5) * 1.5;
        neighbor.vy = (Math.random() - 0.5) * 1.5;
        neighbor.degree = 0;
        neighbor.radius = neighbor.type === 'author' ? 10 : 7;

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

    this.rebuildSimulation();
    this.reheat(0.6);

    return addedCount;
  }

  private rebuildSimulation(): void {
    if (this.simulation) {
      this.simulation.stop();
    }

    // 1. Calculate dynamic degree and radius for each node (Obsidian-style scaling)
    const degreeMap = new Map<string, number>();
    for (const link of this.linksList) {
      const srcId = typeof link.source === 'object' ? link.source.id : link.source;
      const tgtId = typeof link.target === 'object' ? link.target.id : link.target;
      degreeMap.set(srcId, (degreeMap.get(srcId) || 0) + 1);
      degreeMap.set(tgtId, (degreeMap.get(tgtId) || 0) + 1);
    }

    for (const node of this.nodesList) {
      const deg = degreeMap.get(node.id) || 0;
      node.degree = deg;
      const boost = Math.min(Math.sqrt(deg) * 3.5, 14);
      if (node.type === 'author') {
        node.radius = Math.round(9 + boost);
      } else if (node.type === 'work') {
        node.radius = Math.round(5.5 + boost * 0.7);
      } else if (node.type === 'award') {
        node.radius = Math.round(7.5 + boost * 0.8);
      } else if (node.type === 'character') {
        node.radius = Math.round(6.5 + boost * 0.75);
      } else {
        node.radius = Math.round(5 + boost * 0.6);
      }
    }

    // 2. Map links to node objects or string IDs
    const simLinks = this.linksList.map((link) => ({
      source: typeof link.source === 'object' ? link.source.id : link.source,
      target: typeof link.target === 'object' ? link.target.id : link.target,
      predicate: link.predicate,
    }));

    // 3. Obsidian-Grade Force Dynamics (Central Gravity + Mass-Aware Repulsion + Dynamic Springs)
    this.simulation = forceSimulation(this.nodesList)
      .force(
        'link',
        forceLink(simLinks)
          .id((d: any) => d.id)
          .distance((d: any) => {
            const src = d.source as GraphNode2D;
            const tgt = d.target as GraphNode2D;
            const rSum = (src.radius || 8) + (tgt.radius || 8);
            if (src.type === 'author' && tgt.type === 'work') return 30 + rSum * 1.3;
            if (src.type === 'author' && tgt.type === 'character') return 34 + rSum * 1.4;
            return 40 + rSum * 1.5;
          })
          .strength(0.42),
      )
      .force(
        'charge',
        forceManyBody()
          .strength((d: any) => -((d.radius || 8) * 11 + 95))
          .distanceMax(450),
      )
      .force('gravity', forceRadial(0, 0, 0).strength(0.016))
      .force(
        'collide',
        forceCollide()
          .radius((d: any) => (d.radius || 8) + 14)
          .strength(0.7),
      )
      .alphaDecay(0.024)
      .velocityDecay(0.36)
      .stop();
  }

  step(): void {
    if (this.simulation && this.simulation.alpha() >= 0.001) {
      this.simulation.tick();
    }
  }

  isSimulating(): boolean {
    return this.simulation !== null && this.simulation.alpha() >= 0.001;
  }

  reheat(alpha = 0.5): void {
    if (this.simulation) {
      this.simulation.alpha(Math.max(this.simulation.alpha(), alpha));
    }
  }

  pinNode(id: string, x: number, y: number): void {
    const node = this.nodesMap.get(id);
    if (node) {
      node.fx = x;
      node.fy = y;
      node.x = x;
      node.y = y;
      if (this.simulation && this.simulation.alpha() < 0.25) {
        this.simulation.alpha(0.25);
      }
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
      const r = (node.radius || 8) + 10;
      if (distSq < r * r && distSq < minSq) {
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
