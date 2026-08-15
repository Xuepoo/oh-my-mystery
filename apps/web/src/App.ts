import { Scene } from '@vectojs/core';
import type { ChronicleStep, EntityDetailResponse } from '@omm/shared';
import { D1DataSource } from './api/D1DataSource';
import { BackgroundLayer } from './scene/BackgroundLayer';
import { GraphOverlayLayer } from './scene/GraphOverlayLayer';
import { GraphViewport } from './scene/GraphViewport';
import { CasefileDrawer } from './ui/CasefileDrawer';
import { ChroniclePanel } from './ui/ChroniclePanel';
import { HeaderBar } from './ui/HeaderBar';
import { Minimap } from './ui/Minimap';
import { PathfinderModal } from './ui/PathfinderModal';
import { ViewportControls } from './ui/ViewportControls';

export class App {
  readonly scene: Scene;
  readonly graphCanvas: HTMLCanvasElement;
  readonly uiCanvas: HTMLCanvasElement;
  readonly source: D1DataSource;
  readonly viewport: GraphViewport;

  readonly background: BackgroundLayer;
  readonly overlayLayer: GraphOverlayLayer;
  readonly headerBar: HeaderBar;
  readonly drawer: CasefileDrawer;
  readonly chroniclePanel: ChroniclePanel;
  readonly pathfinderModal: PathfinderModal;
  readonly minimap: Minimap;
  readonly controls: ViewportControls;

  private activeEntityDetails: EntityDetailResponse | null = null;

  constructor(graphCanvas: HTMLCanvasElement, uiCanvas: HTMLCanvasElement) {
    this.graphCanvas = graphCanvas;
    this.uiCanvas = uiCanvas;
    this.source = new D1DataSource(import.meta.env.VITE_API_URL || '');

    // 1. Initialize VectoJS Scene on the UI Canvas
    this.scene = new Scene(this.uiCanvas, {
      pointBackend: 'canvas',
      particleBackend: 'auto',
      maxFPS: 60,
    });
    this.scene.resize(window.innerWidth, window.innerHeight);

    // 2. Initialize 2D Knowledge Graph Viewport on the Graph Canvas
    this.viewport = new GraphViewport({
      canvas: this.graphCanvas,
      source: this.source,
      onSelectNode: (entity) => {
        if (entity) {
          void this.handleSelectNode(String(entity.id));
        } else {
          this.drawer.close();
        }
      },
      onHoverNode: (entity) => {
        this.overlayLayer.setHoveredEntity(entity);
      },
    });

    // 3. Mount Entities into Scene
    this.background = new BackgroundLayer();
    this.scene.add(this.background);

    this.overlayLayer = new GraphOverlayLayer(this.viewport);
    this.scene.add(this.overlayLayer);

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

    // 4. Forward Pointer Events to Graph Canvas when not clicking UI
    this.setupEventForwarding();

    // 5. Handle Window Resize
    window.addEventListener('resize', () => {
      this.handleResize();
    });
  }

  isUIHovered(x: number, y: number): boolean {
    if (this.drawer.isPointInside(x, y)) return true;
    if (this.headerBar.isPointInside(x, y)) return true;
    if (this.chroniclePanel.isPointInside(x, y)) return true;
    if (this.pathfinderModal.isPointInside(x, y)) return true;
    if (this.minimap.isPointInside(x, y)) return true;
    if (this.controls.isPointInside(x, y)) return true;
    return false;
  }

  private setupEventForwarding(): void {
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;

    this.uiCanvas.addEventListener('pointerdown', (e: PointerEvent) => {
      const x = e.clientX;
      const y = e.clientY;
      isDragging = false;
      dragStartX = x;
      dragStartY = y;

      // 1. Direct Dispatch to UI Components when clicking UI areas
      if (this.pathfinderModal.isModalOpen()) {
        this.pathfinderModal.handleClick(x, y);
        return;
      }
      if (this.chroniclePanel.isModalOpen()) {
        this.chroniclePanel.handleClick(x, y);
        return;
      }
      if (this.drawer.isDrawerOpen() && this.drawer.isPointInside(x, y)) {
        this.drawer.handleClick(x, y);
        return;
      }
      if (this.headerBar.isPointInside(x, y)) {
        this.headerBar.handleClick(x, y);
        return;
      }
      if (this.controls.isPointInside(x, y)) {
        this.controls.handleClick(x, y);
        return;
      }
      if (this.minimap.isPointInside(x, y)) {
        this.minimap.handleClick(x, y);
        return;
      }

      // 2. Forward to 3D graph canvas for panning
      this.graphCanvas.dispatchEvent(new PointerEvent('pointerdown', e));
    });

    this.uiCanvas.addEventListener('pointermove', (e: PointerEvent) => {
      const x = e.clientX;
      const y = e.clientY;
      if (Math.abs(x - dragStartX) > 4 || Math.abs(y - dragStartY) > 4) {
        isDragging = true;
      }

      if (!this.isUIHovered(x, y)) {
        const hitNode = this.overlayLayer.getNodeAtScreenPoint(x, y);
        this.overlayLayer.setHoveredEntity(hitNode);
        this.uiCanvas.style.cursor = hitNode ? 'pointer' : 'grab';
        this.graphCanvas.dispatchEvent(new PointerEvent('pointermove', e));
      } else {
        this.overlayLayer.setHoveredEntity(null);
        this.uiCanvas.style.cursor = 'default';
      }
    });

    this.uiCanvas.addEventListener('pointerup', (e: PointerEvent) => {
      const x = e.clientX;
      const y = e.clientY;

      if (!this.isUIHovered(x, y)) {
        if (!isDragging) {
          const hitNode = this.overlayLayer.getNodeAtScreenPoint(x, y);
          if (hitNode) {
            void this.handleSelectNode(String(hitNode.id));
          } else if (this.drawer.isDrawerOpen()) {
            // Click outside drawer closes drawer
            this.drawer.close();
          }
        }
        this.graphCanvas.dispatchEvent(new PointerEvent('pointerup', e));
      }
    });

    this.uiCanvas.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        const x = e.clientX;
        const y = e.clientY;
        if (this.drawer.isDrawerOpen() && this.drawer.isPointInside(x, y)) {
          // Handled in drawer
          return;
        }
        if (!this.isUIHovered(x, y)) {
          this.graphCanvas.dispatchEvent(new WheelEvent('wheel', e));
        }
      },
      { passive: false },
    );
  }

  async start(): Promise<void> {
    this.scene.start();
    await this.viewport.init();
  }

  public async handleSelectNode(id: string): Promise<void> {
    this.viewport.focusNode(id);
    void this.viewport.expandNode(id);

    const details = await this.source.fetchEntityDetails(id);
    if (details) {
      this.activeEntityDetails = details;
      this.drawer.open(details);
    }
  }

  public async handleOpenChronicles(): Promise<void> {
    const trails = await this.source.fetchChronicles();
    if (trails.length > 0) {
      this.chroniclePanel.open(trails);
    }
  }

  public toggleFullscreen(): void {
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
