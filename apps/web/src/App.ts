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
import { Minimap } from './ui/Minimap';
import { PathfinderModal } from './ui/PathfinderModal';
import { getEventCoords } from './ui/theme';
import { ViewportControls } from './ui/ViewportControls';

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
  readonly minimap: Minimap;
  readonly controls: ViewportControls;

  private activeEntityDetails: EntityDetailResponse | null = null;
  private isPointerDown = false;
  private isPanning = false;
  private draggedNode: GraphNode2D | null = null;
  private pointerDownPos = { x: 0, y: 0 };
  private lastPointerPos = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.source = new D1DataSource(import.meta.env.VITE_API_URL || '');

    // 1. Initialize Single VectoJS Scene
    this.scene = new Scene(this.canvas, {
      pointBackend: 'canvas',
      particleBackend: 'auto',
      maxFPS: 60,
      autoThrottle: false, // Disable 2 FPS idle throttle to ensure smooth continuous animations
    });
    this.scene.resize(window.innerWidth, window.innerHeight);

    // 2. Initialize 2D Knowledge Graph Viewport
    this.viewport = new GraphViewport({
      source: this.source,
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

    this.minimap = new Minimap(this.viewport);
    this.scene.add(this.minimap);

    this.controls = new ViewportControls(this.viewport);
    this.scene.add(this.controls);

    // 4. Bind Native Canvas Pointer Interactions
    this.setupInteractions();

    // 5. Handle Window Resize
    window.addEventListener('resize', () => {
      this.handleResize();
    });
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
      } else {
        this.isPanning = true;
      }
    });

    window.addEventListener('pointermove', (e) => {
      const { x, y } = getEventCoords(e);

      if (this.isPointerDown) {
        const dx = x - this.lastPointerPos.x;
        const dy = y - this.lastPointerPos.y;
        this.lastPointerPos = { x, y };

        if (this.draggedNode) {
          const worldPos = this.viewport.screenToWorld(x, y);
          this.viewport.graph.pinNode(this.draggedNode.id, worldPos.x, worldPos.y);
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
    });

    window.addEventListener('pointerup', (e) => {
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
    });

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        const { x, y } = getEventCoords(e);
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
}
