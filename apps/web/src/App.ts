import { Scene } from '@vectojs/core';
import type { ChronicleStep, EntityDetailResponse } from '@omm/shared';
import { D1DataSource } from './api/D1DataSource';
import { BackgroundLayer } from './scene/BackgroundLayer';
import { GraphViewport } from './scene/GraphViewport';
import { CasefileDrawer } from './ui/CasefileDrawer';
import { ChroniclePanel } from './ui/ChroniclePanel';
import { HeaderBar } from './ui/HeaderBar';
import { Minimap } from './ui/Minimap';
import { PathfinderModal } from './ui/PathfinderModal';
import { ViewportControls } from './ui/ViewportControls';

export class App {
  readonly scene: Scene;
  readonly canvas: HTMLCanvasElement;
  readonly source: D1DataSource;
  readonly viewport: GraphViewport;

  readonly background: BackgroundLayer;
  readonly headerBar: HeaderBar;
  readonly drawer: CasefileDrawer;
  readonly chroniclePanel: ChroniclePanel;
  readonly pathfinderModal: PathfinderModal;
  readonly minimap: Minimap;
  readonly controls: ViewportControls;

  private activeEntityDetails: EntityDetailResponse | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.source = new D1DataSource(import.meta.env.VITE_API_URL || '');

    // 1. Initialize VectoJS Scene
    this.scene = new Scene(this.canvas, {
      pointBackend: 'webgl',
      particleBackend: 'auto',
      maxFPS: 60,
    });
    this.scene.resize(window.innerWidth, window.innerHeight);

    // 2. Initialize 2D Knowledge Graph Viewport
    this.viewport = new GraphViewport({
      canvas: this.canvas,
      source: this.source,
      onSelectNode: (entity) => {
        if (entity) {
          void this.handleSelectNode(String(entity.id));
        } else {
          this.drawer.close();
        }
      },
      onHoverNode: (_entity) => {},
    });

    // 3. Mount Entities into Scene
    this.background = new BackgroundLayer();
    this.scene.add(this.background);

    this.headerBar = new HeaderBar({
      source: this.source,
      onOpenChronicles: () => {
        void this.handleOpenChronicles();
      },
      onOpenPathfinder: () => {
        this.pathfinderModal.open();
      },
      onSelectSearchResult: (id) => {
        void this.handleSelectNode(id);
      },
      onFilterChange: (_type) => {
        this.viewport.wakeUp();
      },
      onToggleFullscreen: () => {
        this.toggleFullscreen();
      },
    });
    this.scene.add(this.headerBar);

    this.drawer = new CasefileDrawer({
      onClose: () => {
        this.activeEntityDetails = null;
      },
      onSelectEntity: (id) => {
        void this.handleSelectNode(id);
      },
      onStartPathfinder: (id, name) => {
        this.pathfinderModal.open({ id, name });
      },
      onExpandNode: (id) => {
        void this.viewport.expandNode(id);
      },
    });
    this.scene.add(this.drawer);

    this.chroniclePanel = new ChroniclePanel({
      onClose: () => {},
      onStepChange: (step: ChronicleStep) => {
        this.viewport.focusNode(step.primaryEntityId);
        void this.viewport.expandNode(step.primaryEntityId);
      },
    });
    this.scene.add(this.chroniclePanel);

    this.pathfinderModal = new PathfinderModal({
      source: this.source,
      onClose: () => {},
      onHighlightPath: (nodeIds, edges) => {
        this.viewport.highlightPath(nodeIds, edges);
      },
    });
    this.scene.add(this.pathfinderModal);

    this.minimap = new Minimap(this.viewport);
    this.scene.add(this.minimap);

    this.controls = new ViewportControls(this.viewport);
    this.scene.add(this.controls);

    // 4. Handle Window Resize
    window.addEventListener('resize', () => {
      this.handleResize();
    });
  }

  async start(): Promise<void> {
    this.scene.start();
    await this.viewport.init();
  }

  private async handleSelectNode(id: string): Promise<void> {
    this.viewport.focusNode(id);
    void this.viewport.expandNode(id);

    const details = await this.source.fetchEntityDetails(id);
    if (details) {
      this.activeEntityDetails = details;
      this.drawer.open(details);
    }
  }

  private async handleOpenChronicles(): Promise<void> {
    const trails = await this.source.fetchChronicles();
    if (trails.length > 0) {
      this.chroniclePanel.open(trails);
    }
  }

  private toggleFullscreen(): void {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen().catch(() => {});
    } else {
      void document.exitFullscreen().catch(() => {});
    }
  }

  private handleResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.scene.resize(w, h);
    this.viewport.resize(w, h);
  }

  dispose(): void {
    this.scene.stop();
    this.viewport.dispose();
  }
}
