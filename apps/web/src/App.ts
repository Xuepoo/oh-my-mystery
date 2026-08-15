import { Scene } from '@vectojs/core';
import type { ChronicleStep, EntityDetailResponse } from '@omm/shared';
import { D1DataSource } from './api/D1DataSource';
import { BackgroundLayer } from './scene/BackgroundLayer';
import { GraphOverlayLayer } from './scene/GraphOverlayLayer';
import { GraphViewport } from './scene/GraphViewport';
import type { GraphNode2D } from './scene/types';
import { CasefileDrawer } from './ui/CasefileDrawer';
import { ChroniclePanel } from './ui/ChroniclePanel';
import { HeaderBar } from './ui/HeaderBar';
import { HelpModal } from './ui/HelpModal';
import { Minimap } from './ui/Minimap';
import { PathfinderModal } from './ui/PathfinderModal';
import { getEventCoords } from './ui/theme';
import { ViewportControls } from './ui/ViewportControls';
import { WelcomeLayer } from './ui/WelcomeLayer';

export class App {
  readonly scene: Scene;
  readonly canvas: HTMLCanvasElement;
  readonly source: D1DataSource;
  readonly viewport: GraphViewport;

  readonly background: BackgroundLayer;
  readonly overlayLayer: GraphOverlayLayer;
  readonly headerBar: HeaderBar;
  readonly drawer: CasefileDrawer;
  readonly chroniclePanel: ChroniclePanel;
  readonly pathfinderModal: PathfinderModal;
  readonly helpModal: HelpModal;
  readonly welcomeLayer: WelcomeLayer;
  readonly minimap: Minimap;
  readonly controls: ViewportControls;

  private activeEntityDetails: EntityDetailResponse | null = null;
  private isPointerDown = false;
  private isPanning = false;
  private draggedNode: GraphNode2D | null = null;
  private pointerDownPos = { x: 0, y: 0 };
  private lastPointerPos = { x: 0, y: 0 };
  private selectEpoch = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.source = new D1DataSource(import.meta.env.VITE_API_URL || '');

    // 1. Initialize Single VectoJS Scene
    this.scene = new Scene(this.canvas, {
      pointBackend: 'canvas',
      particleBackend: 'auto',
      maxFPS: 60,
    });
    this.scene.resize(window.innerWidth, window.innerHeight);

    // 2. Initialize 2D Knowledge Graph Viewport
    this.viewport = new GraphViewport({
      source: this.source,
      onChange: () => {
        this.scene.markDirty();
      },
      onSelectNode: (node) => {
        if (node) {
          void this.handleSelectNode(node.id);
        } else {
          this.drawer.close();
        }
      },
      onHoverNode: (node) => {
        this.overlayLayer.setHoveredEntity(node);
      },
    });
    this.viewport.resize(window.innerWidth, window.innerHeight);

    // 3. Mount Entities into Scene
    this.background = new BackgroundLayer();
    this.scene.add(this.background);

    this.overlayLayer = new GraphOverlayLayer(this.viewport);
    this.scene.add(this.overlayLayer);

    this.headerBar = new HeaderBar({
      source: this.source,
      onOpenChronicles: () => {
        this.pathfinderModal.close();
        this.drawer.close();
        void this.handleOpenChronicles();
      },
      onOpenPathfinder: () => {
        this.chroniclePanel.close();
        this.drawer.close();
        this.pathfinderModal.open();
      },
      onOpenHelp: () => {
        this.pathfinderModal.close();
        this.chroniclePanel.close();
        this.drawer.close();
        this.helpModal.open();
      },
      onSelectSearchResult: (id) => {
        void this.handleSelectNode(id);
      },
      onFilterChange: (type) => {
        this.overlayLayer.setActiveFilter(type);
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
        this.drawer.close();
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

    this.helpModal = new HelpModal();
    this.scene.add(this.helpModal);

    this.welcomeLayer = new WelcomeLayer({
      source: this.source,
      onSelectEntity: (id) => {
        void this.handleSelectNode(id);
      },
      onOpenHelp: () => {
        this.pathfinderModal.close();
        this.chroniclePanel.close();
        this.drawer.close();
        this.helpModal.open();
      },
    });
    this.scene.add(this.welcomeLayer);

    this.minimap = new Minimap(this.viewport);
    this.scene.add(this.minimap);

    this.controls = new ViewportControls(this.viewport);
    this.scene.add(this.controls);

    // 4. Bind Native Canvas Pointer Interactions
    this.setupInteractions();

    // 5. Handle Window Resize
    window.addEventListener('resize', this.onResize);
  }

  private isEventOverUI(x: number, y: number): boolean {
    return (
      this.headerBar.isPointInside(x, y) ||
      this.drawer.isPointInside(x, y) ||
      this.chroniclePanel.isPointInside(x, y) ||
      this.pathfinderModal.isPointInside(x, y) ||
      this.minimap.isPointInside(x, y) ||
      this.controls.isPointInside(x, y)
    );
  }

  private setupInteractions(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      const { x, y } = getEventCoords(e);
      this.pointerDownPos = { x, y };
      this.lastPointerPos = { x, y };
      this.isPointerDown = true;

      // 1. Dispatch to UI Panels (Highest overlay priority first)
      if (this.helpModal.isPointInside(x, y)) {
        this.helpModal.handleClick(x, y);
        return;
      }
      if (this.pathfinderModal.isPointInside(x, y)) {
        this.pathfinderModal.handleClick(x, y);
        return;
      }
      if (this.chroniclePanel.isPointInside(x, y)) {
        this.chroniclePanel.handleClick(x, y);
        return;
      }
      if (this.drawer.isPointInside(x, y)) {
        this.drawer.handleClick(x, y);
        return;
      }
      if (this.headerBar.isPointInside(x, y)) {
        this.headerBar.handleClick(x, y);
        return;
      }
      if (this.welcomeLayer.isPointInside(x, y)) {
        this.welcomeLayer.handleClick(x, y);
        return;
      }
      if (this.minimap.isPointInside(x, y)) {
        this.minimap.handleClick(x, y);
        return;
      }
      if (this.controls.isPointInside(x, y)) {
        this.controls.handleClick(x, y);
        return;
      }

      // 2. Test Node Click / Drag on Graph
      const hitNode = this.overlayLayer.getNodeAtScreenPoint(x, y);
      if (hitNode) {
        this.draggedNode = hitNode;
        const worldPos = this.viewport.screenToWorld(x, y);
        this.viewport.graph.pinNode(hitNode.id, worldPos.x, worldPos.y);
        this.scene.markDirty();
      } else {
        this.isPanning = true;
      }
    });

    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onWindowKeydown);
    this.setupCanvasWheel();

    // Canvas is the whole app surface: the browser context menu
    // (save image/copy image) is meaningless here.
    this.canvas.addEventListener('contextmenu', this.onCanvasContextMenu);
  }

  private onCanvasContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  // Block browser shortcuts that only make sense for document pages
  // (save page, print). Deliberately does not touch refresh/devtools.
  // Also implements app-level keyboard navigation: Escape closes topmost
  // panel, '?' / 'h' toggles the help modal.
  private onWindowKeydown = (e: KeyboardEvent): void => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod) {
      const key = e.key.toLowerCase();
      if (key === 's' || key === 'p') {
        e.preventDefault();
      }
      return;
    }

    if (e.key === 'Escape') {
      // The search input handles its own Escape (blur + hide dropdown).
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }
      if (this.headerBar.hideDropdown()) return;
      if (this.helpModal.isModalOpen()) {
        this.helpModal.close();
        return;
      }
      if (this.pathfinderModal.isModalOpen()) {
        this.pathfinderModal.close();
        return;
      }
      if (this.chroniclePanel.isModalOpen()) {
        this.chroniclePanel.close();
        return;
      }
      this.drawer.close();
      return;
    }

    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return;
    }
    if (e.key === '?' || e.key === 'h' || e.key === 'H') {
      e.preventDefault();
      if (this.helpModal.isModalOpen()) {
        this.helpModal.close();
      } else {
        this.pathfinderModal.close();
        this.chroniclePanel.close();
        this.drawer.close();
        this.helpModal.open();
      }
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const { x, y } = getEventCoords(e);

    if (this.isPointerDown) {
      const dx = x - this.lastPointerPos.x;
      const dy = y - this.lastPointerPos.y;
      this.lastPointerPos = { x, y };

      if (this.draggedNode) {
        const worldPos = this.viewport.screenToWorld(x, y);
        this.viewport.graph.pinNode(this.draggedNode.id, worldPos.x, worldPos.y);
        this.scene.markDirty();
      } else if (this.isPanning) {
        this.viewport.pan(dx, dy);
      }
    } else {
      // Hover inspection
      if (!this.isEventOverUI(x, y)) {
        const hitNode = this.overlayLayer.getNodeAtScreenPoint(x, y);
        this.overlayLayer.setHoveredEntity(hitNode);
      } else {
        this.overlayLayer.setHoveredEntity(null);
      }
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const { x, y } = getEventCoords(e);
    const moveDist = Math.hypot(x - this.pointerDownPos.x, y - this.pointerDownPos.y);

    if (this.draggedNode) {
      this.viewport.graph.unpinNode(this.draggedNode.id);
      if (moveDist < 6) {
        // Clicked node
        void this.handleSelectNode(this.draggedNode.id);
      }
      this.draggedNode = null;
    } else if (this.isPanning && moveDist < 6 && !this.isEventOverUI(x, y)) {
      // Clicked empty canvas space -> close drawer
      this.drawer.close();
    }

    this.isPointerDown = false;
    this.isPanning = false;
  };

  private setupCanvasWheel(): void {
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        const { x, y } = getEventCoords(e);
        if (this.drawer.isPointInside(x, y)) {
          e.preventDefault();
          this.drawer.handleWheel(e.deltaY);
          return;
        }
        if (this.isEventOverUI(x, y)) {
          return;
        }
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 0.89;
        this.viewport.zoomAt(factor, x, y);
      },
      { passive: false },
    );
  }

  private onResize = (): void => {
    this.handleResize();
  };

  public dispose(): void {
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onWindowKeydown);
    this.canvas.removeEventListener('contextmenu', this.onCanvasContextMenu);
    this.headerBar.dispose();
    this.background.dispose();
    this.scene.stop();
  }

  async start(): Promise<void> {
    this.scene.start();
    await this.viewport.init();
  }

  public async handleSelectNode(id: string): Promise<void> {
    const epoch = ++this.selectEpoch;
    this.scene.markDirty();
    this.viewport.focusNode(id);
    void this.viewport.expandNode(id);

    const details = await this.source.fetchEntityDetails(id);
    if (epoch !== this.selectEpoch) return;
    if (details) {
      this.activeEntityDetails = details;
      this.drawer.open(details);
    }
  }

  public async handleOpenChronicles(): Promise<void> {
    const trails = await this.source.fetchChronicles();
    if (trails.length > 0) {
      this.scene.markDirty();
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
}
