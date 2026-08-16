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

interface HiddenNodeSnapshot {
  node: GraphNode2D;
  pinned: boolean;
  nodeOwners: Set<string>;
  links: { link: GraphLink2D; owners: Set<string> }[];
}

export class KnowledgeGraph2D {
  private source: D1DataSource;
  private nodesMap = new Map<string, GraphNode2D>();
  private nodesList: GraphNode2D[] = [];
  private linksList: GraphLink2D[] = [];
  private factKeySet = new Set<string>();
  private expandedSet = new Set<string>();
  private rootIds = new Set<string>();
  private manualIds = new Set<string>();
  private expansionNodes = new Map<string, Set<string>>();
  private expansionFacts = new Map<string, Set<string>>();
  private nodeOwners = new Map<string, Set<string>>();
  private factOwners = new Map<string, Set<string>>();
  private pinnedIds = new Set<string>();
  private hiddenNodes = new Map<string, HiddenNodeSnapshot>();
  private generation = 0;

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

  getGeneration(): number {
    return this.generation;
  }

  getNode(id: string): GraphNode2D | undefined {
    return this.nodesMap.get(id);
  }

  isExpanded(id: string): boolean {
    return this.expandedSet.has(id);
  }

  getAdjacentIds(id: string): string[] {
    const adjacent = new Set<string>();
    for (const link of this.linksList) {
      const source = typeof link.source === 'object' ? link.source.id : link.source;
      const target = typeof link.target === 'object' ? link.target.id : link.target;
      if (source === id && this.nodesMap.has(target)) adjacent.add(target);
      if (target === id && this.nodesMap.has(source)) adjacent.add(source);
    }
    return [...adjacent];
  }

  async bootstrap(seedNodes: GraphNode2D[]): Promise<void> {
    const generation = this.generation;
    if (generation !== this.generation) return;
    this.nodesMap.clear();
    this.nodesList = [];
    this.linksList = [];
    this.factKeySet.clear();
    this.expandedSet.clear();
    this.rootIds.clear();
    this.manualIds.clear();
    this.expansionNodes.clear();
    this.expansionFacts.clear();
    this.nodeOwners.clear();
    this.factOwners.clear();
    this.pinnedIds.clear();
    this.hiddenNodes.clear();

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
      this.rootIds.add(node.id);
    }

    this.rebuildSimulation();
  }

  async expand(nodeId: string, neighborLimit?: number): Promise<number> {
    const generation = this.generation;
    if (this.expandedSet.has(nodeId)) return 0;
    const centerNode = this.nodesMap.get(nodeId);
    if (!centerNode) return 0;
    const cx = centerNode.x ?? 0;
    const cy = centerNode.y ?? 0;

    const neighborhood = await this.source.getNeighbors(nodeId, { limit: neighborLimit });
    if (generation !== this.generation || !this.nodesMap.has(nodeId)) return 0;
    this.expandedSet.add(nodeId);
    let addedCount = 0;
    const ownedNodes = new Set<string>();
    const ownedFacts = new Set<string>();
    this.expansionNodes.set(nodeId, ownedNodes);
    this.expansionFacts.set(nodeId, ownedFacts);

    // 1. Ingest Neighbors
    const nLen = neighborhood.neighbors.length;
    for (let i = 0; i < nLen; i++) {
      const neighbor = neighborhood.neighbors[i]!;
      ownedNodes.add(neighbor.id);
      let owners = this.nodeOwners.get(neighbor.id);
      if (!owners) {
        owners = new Set();
        this.nodeOwners.set(neighbor.id, owners);
      }
      owners.add(nodeId);
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
      ownedFacts.add(key);
      let owners = this.factOwners.get(key);
      if (!owners) {
        owners = new Set();
        this.factOwners.set(key, owners);
      }
      owners.add(nodeId);
    }

    this.rebuildSimulation();
    this.reheat(0.6);

    return addedCount;
  }

  addManualNode(node: GraphNode2D, x: number, y: number): boolean {
    this.manualIds.add(node.id);
    const existing = this.nodesMap.get(node.id);
    if (existing) return false;
    node.x = x;
    node.y = y;
    node.vx = 0;
    node.vy = 0;
    node.degree = 0;
    node.radius = node.type === 'author' ? 12 : 8;
    this.nodesMap.set(node.id, node);
    this.nodesList.push(node);
    this.rebuildSimulation();
    this.reheat(0.35);
    return true;
  }

  clear(): void {
    this.generation++;
    this.simulation?.stop();
    this.simulation = null;
    this.nodesMap.clear();
    this.nodesList = [];
    this.linksList = [];
    this.factKeySet.clear();
    this.expandedSet.clear();
    this.rootIds.clear();
    this.manualIds.clear();
    this.expansionNodes.clear();
    this.expansionFacts.clear();
    this.nodeOwners.clear();
    this.factOwners.clear();
    this.pinnedIds.clear();
    this.hiddenNodes.clear();
  }

  async toggleExpansion(nodeId: string): Promise<number> {
    if (this.expandedSet.has(nodeId)) {
      this.collapse(nodeId);
      return 0;
    }
    return this.expand(nodeId);
  }

  collapse(nodeId: string): void {
    this.expandedSet.delete(nodeId);
    const ownedNodes = this.expansionNodes.get(nodeId) || new Set<string>();
    const ownedFacts = this.expansionFacts.get(nodeId) || new Set<string>();

    for (const id of ownedNodes) {
      const owners = this.nodeOwners.get(id);
      owners?.delete(nodeId);
      if (!owners?.size) {
        this.nodeOwners.delete(id);
        if (!this.rootIds.has(id) && !this.manualIds.has(id) && !this.expandedSet.has(id)) {
          this.nodesMap.delete(id);
        }
      }
    }
    for (const key of ownedFacts) {
      const owners = this.factOwners.get(key);
      owners?.delete(nodeId);
      if (!owners?.size) {
        this.factOwners.delete(key);
        this.factKeySet.delete(key);
      }
    }
    this.expansionNodes.delete(nodeId);
    this.expansionFacts.delete(nodeId);
    this.nodesList = this.nodesList.filter((node) => this.nodesMap.has(node.id));
    this.linksList = this.linksList.filter((link) => {
      const source = typeof link.source === 'object' ? link.source.id : link.source;
      const target = typeof link.target === 'object' ? link.target.id : link.target;
      return this.factKeySet.has(`${source}|${link.predicate}|${target}`);
    });
    this.rebuildSimulation();
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
    if (node && !this.pinnedIds.has(id)) {
      node.fx = null;
      node.fy = null;
    }
  }

  togglePinned(id: string): boolean {
    const node = this.nodesMap.get(id);
    if (!node) return false;
    if (this.pinnedIds.has(id)) {
      this.pinnedIds.delete(id);
      node.fx = null;
      node.fy = null;
      return false;
    }
    this.pinnedIds.add(id);
    node.fx = node.x ?? 0;
    node.fy = node.y ?? 0;
    return true;
  }

  isPinned(id: string): boolean {
    return this.pinnedIds.has(id);
  }

  relayoutAround(id: string): number {
    const center = this.nodesMap.get(id);
    if (!center) return 0;
    const neighborIds = new Set<string>();
    for (const link of this.linksList) {
      const source = typeof link.source === 'object' ? link.source.id : link.source;
      const target = typeof link.target === 'object' ? link.target.id : link.target;
      if (source === id && this.nodesMap.has(target)) neighborIds.add(target);
      else if (target === id && this.nodesMap.has(source)) neighborIds.add(source);
    }

    const neighbors = [...neighborIds]
      .map((neighborId) => this.nodesMap.get(neighborId))
      .filter((node): node is GraphNode2D => Boolean(node) && !this.pinnedIds.has(node!.id));
    if (!neighbors.length) return 0;

    const cx = center.x ?? 0;
    const cy = center.y ?? 0;
    const ring = Math.max(95, Math.min(190, 70 + neighbors.length * 5));
    for (let i = 0; i < neighbors.length; i++) {
      const node = neighbors[i]!;
      const angle = -Math.PI / 2 + (i / neighbors.length) * Math.PI * 2;
      node.x = cx + Math.cos(angle) * ring;
      node.y = cy + Math.sin(angle) * ring;
      node.vx = 0;
      node.vy = 0;
      node.fx = null;
      node.fy = null;
    }
    this.reheat(0.28);
    return neighbors.length;
  }

  hideNode(id: string): boolean {
    if (!this.nodesMap.has(id)) return false;
    if (this.expandedSet.has(id)) this.collapse(id);

    const node = this.nodesMap.get(id)!;
    const nodeOwners = new Set(this.nodeOwners.get(id) || []);
    const incidentLinks: HiddenNodeSnapshot['links'] = [];
    for (const link of this.linksList) {
      const source = typeof link.source === 'object' ? link.source.id : link.source;
      const target = typeof link.target === 'object' ? link.target.id : link.target;
      if (source !== id && target !== id) continue;
      const key = `${source}|${link.predicate}|${target}`;
      incidentLinks.push({
        link: { source, target, predicate: link.predicate },
        owners: new Set(this.factOwners.get(key) || []),
      });
    }
    this.hiddenNodes.set(id, {
      node,
      pinned: this.pinnedIds.has(id),
      nodeOwners,
      links: incidentLinks,
    });

    this.nodesMap.delete(id);
    this.nodesList = this.nodesList.filter((node) => node.id !== id);
    this.pinnedIds.delete(id);

    this.linksList = this.linksList.filter((link) => {
      const source = typeof link.source === 'object' ? link.source.id : link.source;
      const target = typeof link.target === 'object' ? link.target.id : link.target;
      if (source !== id && target !== id) return true;
      const key = `${source}|${link.predicate}|${target}`;
      this.factKeySet.delete(key);
      this.factOwners.delete(key);
      return false;
    });

    for (const nodes of this.expansionNodes.values()) nodes.delete(id);
    this.nodeOwners.delete(id);
    this.rebuildSimulation();
    this.reheat(0.35);
    return true;
  }

  getHiddenNodes(): readonly GraphNode2D[] {
    return [...this.hiddenNodes.values()].map((snapshot) => snapshot.node);
  }

  restoreNode(id: string): boolean {
    const restored = this.restoreHiddenNode(id);
    if (!restored) return false;
    this.rebuildSimulation();
    this.reheat(0.35);
    return true;
  }

  private restoreHiddenNode(id: string): boolean {
    const snapshot = this.hiddenNodes.get(id);
    if (!snapshot || this.nodesMap.has(id)) return false;

    this.hiddenNodes.delete(id);
    this.nodesMap.set(id, snapshot.node);
    this.nodesList.push(snapshot.node);
    if (snapshot.pinned) {
      this.pinnedIds.add(id);
      snapshot.node.fx = snapshot.node.x ?? 0;
      snapshot.node.fy = snapshot.node.y ?? 0;
    }

    const owners = new Set([...snapshot.nodeOwners].filter((owner) => this.expandedSet.has(owner)));
    if (owners.size) {
      this.nodeOwners.set(id, owners);
      for (const owner of owners) this.expansionNodes.get(owner)?.add(id);
    }

    for (const { link, owners: savedOwners } of snapshot.links) {
      const source = typeof link.source === 'object' ? link.source.id : link.source;
      const target = typeof link.target === 'object' ? link.target.id : link.target;
      if (!this.nodesMap.has(source) || !this.nodesMap.has(target)) continue;
      const key = `${source}|${link.predicate}|${target}`;
      const factOwners = new Set([...savedOwners].filter((owner) => this.expandedSet.has(owner)));
      if (!factOwners.size || this.factKeySet.has(key)) continue;
      this.factKeySet.add(key);
      this.factOwners.set(key, factOwners);
      this.linksList.push({ source, target, predicate: link.predicate });
      for (const owner of factOwners) this.expansionFacts.get(owner)?.add(key);
    }

    return true;
  }

  restoreAllHidden(): number {
    let restored = 0;
    for (const id of [...this.hiddenNodes.keys()]) {
      if (this.restoreHiddenNode(id)) restored++;
    }
    if (restored) {
      this.rebuildSimulation();
      this.reheat(0.35);
    }
    return restored;
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
