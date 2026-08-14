import { KnowledgeGraphSession, type KgEntity, pickLabel } from '@vectojs/knowledge-graph';
import * as THREE from 'three';
import type { D1DataSource } from '../api/D1DataSource';
import { Theme } from '../ui/theme';

export interface GraphViewportOptions {
  canvas: HTMLCanvasElement;
  source: D1DataSource;
  onSelectNode: (entity: KgEntity | null) => void;
  onHoverNode: (entity: KgEntity | null) => void;
}

export class GraphViewport {
  private canvas: HTMLCanvasElement;
  private source: D1DataSource;
  private renderer: THREE.WebGLRenderer;
  private threeScene: THREE.Scene;
  private session: KnowledgeGraphSession;
  private animFrameId: number | null = null;
  private isSettled = false;
  private isFrozen = false;
  private activeHighlightNodes = new Set<string>();
  private activeHighlightEdges = new Set<string>();
  private onSelectCb: (entity: KgEntity | null) => void;
  private onHoverCb: (entity: KgEntity | null) => void;

  constructor(options: GraphViewportOptions) {
    this.canvas = options.canvas;
    this.source = options.source;
    this.onSelectCb = options.onSelectNode;
    this.onHoverCb = options.onHoverNode;

    // 1. Initialize Three.js WebGLRenderer on the target canvas
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);

    this.threeScene = new THREE.Scene();

    // 2. Initialize KnowledgeGraphSession in 2D Mode
    this.session = new KnowledgeGraphSession({
      domElement: this.canvas,
      source: this.source,
      mode: '2d',
      lang: 'zh',
      expandOnSelect: true,
      graphOptions: {
        nodeRadius: 5,
        linkOpacity: 0.45,
        linkColor: Theme.colors.edgeDefault,
        nodeColor: Theme.colors.author,
      },
      onSelect: (entity) => {
        this.onSelectCb(entity);
        this.wakeUp();
      },
      onHover: (entity) => {
        this.onHoverCb(entity);
      },
      onExpand: (_entity, added) => {
        if (added > 0) {
          this.wakeUp();
        }
      },
    });

    this.session.attach(this.threeScene);
  }

  async init(seedIds?: string[]): Promise<void> {
    const seeds =
      seedIds && seedIds.length > 0 ? seedIds : (await this.source.fetchSeeds()).map((s) => s.id);

    await this.session.bootstrap(seeds, false);
    this.fitToView();
    this.startLoop();
  }

  wakeUp(): void {
    this.isSettled = false;
    if (this.animFrameId == null) {
      this.startLoop();
    }
  }

  freeze(frozen: boolean): void {
    this.isFrozen = frozen;
    if (!frozen) {
      this.wakeUp();
    }
  }

  isPhysicsFrozen(): boolean {
    return this.isFrozen;
  }

  fitToView(): void {
    const positions = (this.session as any).layout?.positions;
    if (positions && positions.length > 0) {
      this.session.camera.fitToPositions(positions);
    }
    this.wakeUp();
  }

  resetZoom(): void {
    this.fitToView();
  }

  async expandNode(id: string): Promise<number> {
    const added = await this.session.expand(id);
    this.wakeUp();
    return added;
  }

  focusNode(id: string): void {
    const entities = this.session.listEntities();
    const index = entities.findIndex((e) => String(e.id) === id);
    if (index !== -1) {
      const positions = (this.session as any).layout?.positions;
      if (positions && positions.length > index * 3 + 1) {
        const x = positions[index * 3];
        const y = positions[index * 3 + 1];
        if (Number.isFinite(x) && Number.isFinite(y)) {
          this.session.camera.camera.position.set(x, y, 500);
          (this.session.camera.camera as any).lookAt?.(x, y, 0);
          (this.session.camera as any).target?.set(x, y, 0);
        }
      }
    }
    this.wakeUp();
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

    this.wakeUp();
  }

  clearHighlight(): void {
    this.activeHighlightNodes.clear();
    this.activeHighlightEdges.clear();
    this.wakeUp();
  }

  resize(width: number, height: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.session.setSize(width, height);
    this.wakeUp();
  }

  getEntities(): KgEntity[] {
    return this.session.listEntities();
  }

  getNodeLabel(entity: KgEntity, lang = 'zh'): string {
    return pickLabel(entity.labels, lang);
  }

  private startLoop(): void {
    if (this.animFrameId != null) return;

    const frame = () => {
      if (!this.isFrozen) {
        this.isSettled = this.session.tick(1);
      }
      this.session.render(this.renderer, this.threeScene);

      if (!this.isSettled && !this.isFrozen) {
        this.animFrameId = requestAnimationFrame(frame);
      } else {
        this.animFrameId = null;
      }
    };

    this.animFrameId = requestAnimationFrame(frame);
  }

  dispose(): void {
    if (this.animFrameId != null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.session.dispose();
    this.renderer.dispose();
  }
}
