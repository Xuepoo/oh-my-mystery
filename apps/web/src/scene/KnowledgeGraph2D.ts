import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  type Simulation,
} from 'd3-force';
import type { D1DataSource } from '../api/D1DataSource';
import {
  type DistributionMode,
  type NodeStyleSettings,
  NodeStyleRegistry,
  normalizeNodeType,
} from '../node-style-settings';
import type { GraphLink2D, GraphNode2D } from './types';

export interface KnowledgeGraph2DOptions {
  source: D1DataSource;
  styleSettings?: NodeStyleSettings;
}

interface HiddenNodeSnapshot {
  node: GraphNode2D;
  pinned: boolean;
  nodeOwners: Set<string>;
  links: { link: GraphLink2D; owners: Set<string> }[];
}

export interface KnowledgeGraphSnapshot {
  nodes: GraphNode2D[];
  links: GraphLink2D[];
  roots: string[];
  manual: string[];
  expanded: string[];
  expansionState?: {
    id: string;
    cursor?: string;
    filter: string;
    nodes: string[];
    facts: string[];
  }[];
  pinned: { id: string; x: number; y: number }[];
  hidden: {
    node: GraphNode2D;
    pinned: boolean;
    links: { link: GraphLink2D; owners: string[] }[];
  }[];
  pathNodes: string[];
  pathFacts: string[];
}

type ExpansionSnapshot = NonNullable<KnowledgeGraphSnapshot['expansionState']>[number];

export class KnowledgeGraph2D {
  private source: D1DataSource;
  private styleRegistry: NodeStyleRegistry;
  private distribution: DistributionMode;
  private nodesMap = new Map<string, GraphNode2D>();
  private nodesList: GraphNode2D[] = [];
  private linksList: GraphLink2D[] = [];
  private factKeySet = new Set<string>();
  private expandedSet = new Set<string>();
  private expansionCursors = new Map<string, string>();
  private expansionFilters = new Map<string, string>();
  private expansionRequests = new Map<string, number>();
  private rootIds = new Set<string>();
  private manualIds = new Set<string>();
  private expansionNodes = new Map<string, Set<string>>();
  private expansionFacts = new Map<string, Set<string>>();
  private nodeOwners = new Map<string, Set<string>>();
  private factOwners = new Map<string, Set<string>>();
  private pinnedIds = new Set<string>();
  private hiddenNodes = new Map<string, HiddenNodeSnapshot>();
  private pathNodeIds = new Set<string>();
  private pathFactKeys = new Set<string>();
  private generation = 0;

  private simulation: Simulation<GraphNode2D, any> | null = null;

  constructor(options: KnowledgeGraph2DOptions) {
    this.source = options.source;
    const settings = options.styleSettings;
    this.styleRegistry = new NodeStyleRegistry(settings);
    this.distribution = settings?.distribution || 'balanced';
  }

  applyStyleSettings(settings: NodeStyleSettings): void {
    this.styleRegistry = new NodeStyleRegistry(settings);
    this.distribution = settings.distribution;
    this.rebuildSimulation();
    this.reheat(0.4);
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

  exportSnapshot(): KnowledgeGraphSnapshot {
    return {
      nodes: this.nodesList.map((node) => ({ ...node, labels: { ...node.labels } })),
      links: this.linksList.map((link) => ({ ...link })),
      roots: [...this.rootIds],
      manual: [...this.manualIds],
      expanded: [...this.expandedSet],
      expansionState: [...this.expandedSet].map((id) => ({
        id,
        cursor: this.expansionCursors.get(id),
        filter: this.expansionFilters.get(id) ?? '',
        nodes: [...(this.expansionNodes.get(id) ?? [])],
        facts: [...(this.expansionFacts.get(id) ?? [])],
      })),
      pinned: [...this.pinnedIds]
        .map((id) => this.nodesMap.get(id))
        .filter((node): node is GraphNode2D => Boolean(node))
        .map((node) => ({ id: node.id, x: node.x ?? 0, y: node.y ?? 0 })),
      hidden: [...this.hiddenNodes.values()].map((snapshot) => ({
        node: { ...snapshot.node, labels: { ...snapshot.node.labels } },
        pinned: snapshot.pinned,
        links: snapshot.links.map(({ link, owners }) => ({
          link: { ...link },
          owners: [...owners],
        })),
      })),
      pathNodes: [...this.pathNodeIds],
      pathFacts: [...this.pathFactKeys],
    };
  }

  importSnapshot(snapshot: KnowledgeGraphSnapshot): void {
    this.clear();
    const validNodes = snapshot.nodes.filter((node) => node && typeof node.id === 'string');
    for (const node of validNodes) {
      node.labels = { ...node.labels };
      node.color = this.styleRegistry.getColor(node.type);
      this.nodesMap.set(node.id, node);
      this.nodesList.push(node);
    }
    this.linksList = snapshot.links
      .filter((link) => {
        const source = typeof link.source === 'object' ? link.source.id : link.source;
        const target = typeof link.target === 'object' ? link.target.id : link.target;
        return this.nodesMap.has(source) && this.nodesMap.has(target);
      })
      .map((link) => ({ ...link }));
    for (const link of this.linksList) {
      const source = typeof link.source === 'object' ? link.source.id : link.source;
      const target = typeof link.target === 'object' ? link.target.id : link.target;
      const key = `${source}|${link.predicate}|${target}`;
      this.factKeySet.add(key);
      this.factOwners.set(key, new Set());
    }
    this.rootIds = new Set(snapshot.roots.filter((id) => this.nodesMap.has(id)));
    this.manualIds = new Set(snapshot.manual.filter((id) => this.nodesMap.has(id)));
    this.expandedSet = new Set(snapshot.expanded.filter((id) => this.nodesMap.has(id)));
    this.pathNodeIds = new Set(snapshot.pathNodes.filter((id) => this.nodesMap.has(id)));
    this.pathFactKeys = new Set(snapshot.pathFacts.filter((key) => this.factKeySet.has(key)));
    const expansionState: ExpansionSnapshot[] = snapshot.expansionState?.length
      ? snapshot.expansionState
      : [...this.expandedSet].map((id) => ({
          id,
          filter: '',
          nodes: this.getAdjacentIds(id),
          facts: this.linksList
            .filter((link) => {
              const source = typeof link.source === 'object' ? link.source.id : link.source;
              const target = typeof link.target === 'object' ? link.target.id : link.target;
              return source === id || target === id;
            })
            .map((link) => {
              const source = typeof link.source === 'object' ? link.source.id : link.source;
              const target = typeof link.target === 'object' ? link.target.id : link.target;
              return `${source}|${link.predicate}|${target}`;
            }),
        }));
    for (const state of expansionState) {
      if (!this.expandedSet.has(state.id)) continue;
      if (state.cursor) this.expansionCursors.set(state.id, state.cursor);
      this.expansionFilters.set(state.id, state.filter);
      const ownedNodes = new Set(state.nodes.filter((id) => this.nodesMap.has(id)));
      const ownedFacts = new Set(state.facts.filter((key) => this.factKeySet.has(key)));
      this.expansionNodes.set(state.id, ownedNodes);
      this.expansionFacts.set(state.id, ownedFacts);
      for (const id of ownedNodes) {
        const owners = this.nodeOwners.get(id) ?? new Set<string>();
        owners.add(state.id);
        this.nodeOwners.set(id, owners);
      }
      for (const key of ownedFacts) this.factOwners.get(key)?.add(state.id);
    }
    for (const pin of snapshot.pinned) {
      const node = this.nodesMap.get(pin.id);
      if (!node) continue;
      this.pinnedIds.add(pin.id);
      node.x = pin.x;
      node.y = pin.y;
      node.fx = pin.x;
      node.fy = pin.y;
    }
    for (const hidden of snapshot.hidden) {
      if (this.nodesMap.has(hidden.node.id)) continue;
      this.hiddenNodes.set(hidden.node.id, {
        node: hidden.node,
        pinned: hidden.pinned,
        nodeOwners: new Set(),
        links: hidden.links.map(({ link, owners }) => ({
          link: { ...link },
          owners: new Set(owners),
        })),
      });
    }
    this.rebuildSimulation();
    this.reheat(0.25);
  }

  isExpanded(id: string): boolean {
    return this.expandedSet.has(id);
  }

  canLoadMore(id: string): boolean {
    return this.expansionCursors.has(id);
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
    this.expansionCursors.clear();
    this.expansionFilters.clear();
    this.expansionRequests.clear();
    this.rootIds.clear();
    this.manualIds.clear();
    this.expansionNodes.clear();
    this.expansionFacts.clear();
    this.nodeOwners.clear();
    this.factOwners.clear();
    this.pinnedIds.clear();
    this.hiddenNodes.clear();
    this.pathNodeIds.clear();
    this.pathFactKeys.clear();

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
      node.color = this.styleRegistry.getColor(node.type);
      node.radius = this.baseRadius(node.type);
      this.nodesMap.set(node.id, node);
      this.nodesList.push(node);
      this.rootIds.add(node.id);
    }

    this.rebuildSimulation();
  }

  async expand(
    nodeId: string,
    neighborLimit?: number,
    predicates?: readonly string[],
  ): Promise<number> {
    const generation = this.generation;
    const centerNode = this.nodesMap.get(nodeId);
    if (!centerNode) return 0;
    const filterKey = [...(predicates ?? [])].sort().join(',');
    const filterChanged =
      this.expandedSet.has(nodeId) && this.expansionFilters.get(nodeId) !== filterKey;
    if (this.expandedSet.has(nodeId) && !filterChanged && !this.expansionCursors.has(nodeId)) {
      return 0;
    }
    const cx = centerNode.x ?? 0;
    const cy = centerNode.y ?? 0;
    const request = (this.expansionRequests.get(nodeId) ?? 0) + 1;
    this.expansionRequests.set(nodeId, request);

    const neighborhood = await this.source.getNeighbors(nodeId, {
      limit: neighborLimit,
      cursor: filterChanged ? undefined : this.expansionCursors.get(nodeId),
      predicates,
    });
    if (
      generation !== this.generation ||
      !this.nodesMap.has(nodeId) ||
      this.expansionRequests.get(nodeId) !== request ||
      neighborhood.failed
    ) {
      return 0;
    }
    if (filterChanged) this.collapse(nodeId);
    const firstPage = !this.expandedSet.has(nodeId);
    this.expandedSet.add(nodeId);
    this.expansionFilters.set(nodeId, filterKey);
    if (neighborhood.nextCursor) this.expansionCursors.set(nodeId, neighborhood.nextCursor);
    else this.expansionCursors.delete(nodeId);
    let addedCount = 0;
    const ownedNodes = this.expansionNodes.get(nodeId) ?? new Set<string>();
    const ownedFacts = this.expansionFacts.get(nodeId) ?? new Set<string>();
    if (firstPage) {
      this.expansionNodes.set(nodeId, ownedNodes);
      this.expansionFacts.set(nodeId, ownedFacts);
    }

    // 1. Ingest Neighbors
    const nLen = neighborhood.neighbors.length;
    const canonicalIds = new Map<string, string>();
    const identities = new Map<string, string>();
    for (const id of ownedNodes) {
      const existing = this.nodesMap.get(id);
      if (existing) identities.set(this.nodeIdentity(existing), id);
    }
    for (let i = 0; i < nLen; i++) {
      const neighbor = neighborhood.neighbors[i]!;
      const identity = this.nodeIdentity(neighbor);
      const canonicalId = identities.get(identity);
      if (canonicalId && canonicalId !== neighbor.id) {
        canonicalIds.set(neighbor.id, canonicalId);
        continue;
      }
      identities.set(identity, neighbor.id);
      ownedNodes.add(neighbor.id);
      let owners = this.nodeOwners.get(neighbor.id);
      if (!owners) {
        owners = new Set();
        this.nodeOwners.set(neighbor.id, owners);
      }
      owners.add(nodeId);
      if (!this.nodesMap.has(neighbor.id)) {
        const hash = this.hash(nodeId + ':' + neighbor.id);
        const angle = (i / Math.max(1, nLen)) * Math.PI * 2 + ((hash % 1000) / 1000 - 0.5) * 0.4;
        const distanceScale =
          this.distribution === 'compact' ? 0.8 : this.distribution === 'dispersed' ? 1.25 : 1;
        const dist = (45 + (hash % 36)) * distanceScale;
        neighbor.x = cx + Math.cos(angle) * dist;
        neighbor.y = cy + Math.sin(angle) * dist;
        neighbor.vx = (((hash >>> 8) % 1000) / 1000 - 0.5) * 1.5;
        neighbor.vy = (((hash >>> 18) % 1000) / 1000 - 0.5) * 1.5;
        neighbor.degree = 0;
        neighbor.color = this.styleRegistry.getColor(neighbor.type);
        neighbor.radius = this.baseRadius(neighbor.type);

        this.nodesMap.set(neighbor.id, neighbor);
        this.nodesList.push(neighbor);
        addedCount++;
      }
    }

    // 2. Ingest Relational Facts
    for (const f of neighborhood.facts) {
      const rawSrcId = typeof f.source === 'object' ? f.source.id : f.source;
      const rawTgtId = typeof f.target === 'object' ? f.target.id : f.target;
      const srcId = canonicalIds.get(rawSrcId) ?? rawSrcId;
      const tgtId = canonicalIds.get(rawTgtId) ?? rawTgtId;
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
    node.color = this.styleRegistry.getColor(node.type);
    node.radius = this.baseRadius(node.type);
    this.nodesMap.set(node.id, node);
    this.nodesList.push(node);
    this.rebuildSimulation();
    this.reheat(0.35);
    return true;
  }

  addPath(nodes: GraphNode2D[], edges: GraphLink2D[]): void {
    const nextNodeIds = new Set(nodes.map((node) => node.id));
    const nextFactKeys = new Set(
      edges.map((edge) => {
        const source = typeof edge.source === 'object' ? edge.source.id : edge.source;
        const target = typeof edge.target === 'object' ? edge.target.id : edge.target;
        return `${source}|${edge.predicate}|${target}`;
      }),
    );

    for (const key of this.pathFactKeys) {
      if (nextFactKeys.has(key) || this.factOwners.get(key)?.size) continue;
      this.factKeySet.delete(key);
      this.linksList = this.linksList.filter((link) => {
        const source = typeof link.source === 'object' ? link.source.id : link.source;
        const target = typeof link.target === 'object' ? link.target.id : link.target;
        return `${source}|${link.predicate}|${target}` !== key;
      });
    }
    for (const id of this.pathNodeIds) {
      if (
        nextNodeIds.has(id) ||
        this.rootIds.has(id) ||
        this.manualIds.has(id) ||
        this.expandedSet.has(id) ||
        this.nodeOwners.get(id)?.size
      ) {
        continue;
      }
      this.nodesMap.delete(id);
      this.nodesList = this.nodesList.filter((node) => node.id !== id);
    }

    const center = this.nodesList.length
      ? this.getBoundingBox()
      : { minX: -100, minY: -100, maxX: 100, maxY: 100 };
    const cx = (center.minX + center.maxX) / 2;
    const cy = (center.minY + center.maxY) / 2;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      if (this.hiddenNodes.has(node.id)) this.restoreHiddenNode(node.id);
      if (this.nodesMap.has(node.id)) continue;
      const angle = -Math.PI / 2 + (i / Math.max(1, nodes.length)) * Math.PI * 2;
      node.x = cx + Math.cos(angle) * 120;
      node.y = cy + Math.sin(angle) * 120;
      node.vx = 0;
      node.vy = 0;
      node.color = this.styleRegistry.getColor(node.type);
      node.radius = this.baseRadius(node.type);
      this.nodesMap.set(node.id, node);
      this.nodesList.push(node);
    }
    for (const edge of edges) {
      const source = typeof edge.source === 'object' ? edge.source.id : edge.source;
      const target = typeof edge.target === 'object' ? edge.target.id : edge.target;
      if (!this.nodesMap.has(source) || !this.nodesMap.has(target)) continue;
      const key = `${source}|${edge.predicate}|${target}`;
      if (this.factKeySet.has(key)) continue;
      this.factKeySet.add(key);
      this.linksList.push({ source, target, predicate: edge.predicate });
    }
    this.pathNodeIds = nextNodeIds;
    this.pathFactKeys = nextFactKeys;
    this.rebuildSimulation();
    this.reheat(0.35);
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
    this.expansionCursors.clear();
    this.expansionFilters.clear();
    this.expansionRequests.clear();
    this.rootIds.clear();
    this.manualIds.clear();
    this.expansionNodes.clear();
    this.expansionFacts.clear();
    this.nodeOwners.clear();
    this.factOwners.clear();
    this.pinnedIds.clear();
    this.hiddenNodes.clear();
    this.pathNodeIds.clear();
    this.pathFactKeys.clear();
  }

  async toggleExpansion(nodeId: string, predicates?: readonly string[]): Promise<number> {
    if (this.expandedSet.has(nodeId)) {
      const filterKey = [...(predicates ?? [])].sort().join(',');
      if (this.expansionFilters.get(nodeId) !== filterKey || this.expansionCursors.has(nodeId)) {
        return this.expand(nodeId, undefined, predicates);
      }
      this.collapse(nodeId);
      return 0;
    }
    return this.expand(nodeId, undefined, predicates);
  }

  collapse(nodeId: string): void {
    this.expansionRequests.set(nodeId, (this.expansionRequests.get(nodeId) ?? 0) + 1);
    this.expandedSet.delete(nodeId);
    this.expansionCursors.delete(nodeId);
    this.expansionFilters.delete(nodeId);
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
      const normalizedType = normalizeNodeType(node.type);
      const boost = Math.min(Math.sqrt(deg) * 3.5, 14);
      const base = this.baseRadius(normalizedType);
      node.color = this.styleRegistry.getColor(normalizedType);
      node.radius = Math.round(base + boost * this.degreeBoost(normalizedType));
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
            const modeScale =
              this.distribution === 'compact' ? 0.82 : this.distribution === 'dispersed' ? 1.25 : 1;
            if (src.type === 'author' && tgt.type === 'work') return (30 + rSum * 1.3) * modeScale;
            if (src.type === 'author' && tgt.type === 'character')
              return (34 + rSum * 1.4) * modeScale;
            return (40 + rSum * 1.5) * modeScale;
          })
          .strength(0.42),
      )
      .force(
        'charge',
        forceManyBody()
          .strength(
            (d: any) => -((d.radius || 8) * 11 + (this.distribution === 'dispersed' ? 135 : 95)),
          )
          .distanceMax(
            this.distribution === 'compact' ? 360 : this.distribution === 'dispersed' ? 560 : 450,
          ),
      )
      .force('gravity', forceRadial(0, 0, 0).strength(0.016))
      .force(
        'collide',
        forceCollide()
          .radius(
            (d: any) =>
              (d.radius || 8) +
              (this.distribution === 'compact' ? 10 : this.distribution === 'dispersed' ? 20 : 14),
          )
          .strength(0.7),
      )
      .alphaDecay(0.024)
      .velocityDecay(0.36)
      .stop();
  }

  private baseRadius(type: unknown): number {
    const normalized = normalizeNodeType(type);
    const base =
      normalized === 'author'
        ? 9
        : normalized === 'work'
          ? 5.5
          : normalized === 'award'
            ? 7.5
            : normalized === 'character'
              ? 6.5
              : 5;
    return base * this.styleRegistry.getSizeMultiplier(normalized);
  }

  private nodeIdentity(node: GraphNode2D): string {
    const name = node.name
      .replace(/^[（([【][日中美英法德俄韩港台欧日\w\s]+[）)\]】][、，,\s·.]*/g, '')
      .replace(/^(原作|作畫|作画|著|编|譯|译|繪|絵|画|イラスト)[：:\s]+/g, '')
      .replace(/[\u529b]イウ/g, 'カイウ')
      .replace(/^[（([【()\]】、，,·.\s]+|[（([【()\]】、，,·.\s]+$/g, '')
      .replace(
        /[戶亂東島莊綾賞獎獲館筆書國會]/g,
        (value) =>
          ({
            戶: '户',
            亂: '乱',
            東: '东',
            島: '岛',
            莊: '庄',
            綾: '绫',
            賞: '奖',
            獎: '奖',
            獲: '获',
            館: '馆',
            筆: '笔',
            書: '书',
            國: '国',
            會: '会',
          })[value]!,
      )
      .toLowerCase()
      .replace(/[\s\-_·.]+/g, '');
    return `${node.type}|${name}`;
  }

  private degreeBoost(type: unknown): number {
    const normalized = normalizeNodeType(type);
    return normalized === 'author'
      ? 1
      : normalized === 'work'
        ? 0.7
        : normalized === 'award'
          ? 0.8
          : normalized === 'character'
            ? 0.75
            : 0.6;
  }

  private hash(value: string): number {
    let hash = 2166136261;
    for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return hash >>> 0;
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
