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
  private activePointers = new Map<number, { x: number; y: number }>();
  private pinchState: { prevDist: number; prevMidX: number; prevMidY: number } | null = null;
  private lastPanTime = 0;
  private panVelocity = { vx: 0, vy: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // The canvas owns the whole surface: disable native browser touch
    // gestures (page pinch-zoom / scroll) so pointer events stay ours.
    this.canvas.style.touchAction = 'none';
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
      this.lastPanTime = performance.now();
      this.panVelocity = { vx: 0, vy: 0 };
      this.activePointers.set(e.pointerId, { x, y });

      if (this.activePointers.size >= 2) {
        // Second finger lands: switch to pinch gesture
        if (this.draggedNode) {
          this.viewport.graph.unpinNode(this.draggedNode.id);
          this.draggedNode = null;
        }
        this.isPanning = false;
        const pts = [...this.activePointers.values()];
        const [a, b] = pts.slice(-2);
        this.pinchState = {
          prevDist: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1),
          prevMidX: (a.x + b.x) / 2,
          prevMidY: (a.y + b.y) / 2,
        };
        return;
      }
      this.pinchState = null;

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
    window.addEventListener('pointercancel', this.onPointerCancel);
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
    this.activePointers.set(e.pointerId, { x, y });

    if (this.pinchState && this.activePointers.size >= 2) {
      const pts = [...this.activePointers.values()];
      const [a, b] = pts.slice(-2);
      const dist = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      this.viewport.zoomAt(dist / this.pinchState.prevDist, midX, midY);
      this.viewport.pan(midX - this.pinchState.prevMidX, midY - this.pinchState.prevMidY);
      this.pinchState = { prevDist: dist, prevMidX: midX, prevMidY: midY };
      return;
    }

    if (this.isPointerDown) {
      const now = performance.now();
      const dt = now - this.lastPanTime;
      const dx = x - this.lastPointerPos.x;
      const dy = y - this.lastPointerPos.y;
      this.lastPointerPos = { x, y };

      if (this.draggedNode) {
        const worldPos = this.viewport.screenToWorld(x, y);
        this.viewport.graph.pinNode(this.draggedNode.id, worldPos.x, worldPos.y);
        this.scene.markDirty();
      } else if (this.isPanning) {
        this.viewport.pan(dx, dy);
        if (dt >= 4) {
          // EMA-smoothed velocity for fling inertia on release
          // (dt guard avoids spikes from same-frame synthetic events)
          const alpha = 0.35;
          this.panVelocity.vx = this.panVelocity.vx * (1 - alpha) + (dx / dt) * alpha;
          this.panVelocity.vy = this.panVelocity.vy * (1 - alpha) + (dy / dt) * alpha;
        }
      }
      this.lastPanTime = now;
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
    this.activePointers.delete(e.pointerId);

    if (this.activePointers.size === 1) {
      // Pinch ended, one finger remains: resume panning from that finger
      const remaining = [...this.activePointers.values()][0];
      this.pinchState = null;
      this.isPointerDown = true;
      this.isPanning = true;
      this.draggedNode = null;
      this.pointerDownPos = { x: remaining.x, y: remaining.y };
      this.lastPointerPos = { x: remaining.x, y: remaining.y };
      this.lastPanTime = performance.now();
      this.panVelocity = { vx: 0, vy: 0 };
      return;
    }
    if (this.activePointers.size === 0) {
      this.pinchState = null;
    } else {
      return;
    }

    const moveDist = Math.hypot(x - this.pointerDownPos.x, y - this.pointerDownPos.y);

    if (this.draggedNode) {
      this.viewport.graph.unpinNode(this.draggedNode.id);
      if (moveDist < 6) {
        // Clicked node
        void this.handleSelectNode(this.draggedNode.id);
      }
      this.draggedNode = null;
    } else if (this.isPanning) {
      if (moveDist < 6 && !this.isEventOverUI(x, y)) {
        // Clicked empty canvas space -> close drawer
        this.drawer.close();
      } else if (moveDist >= 6) {
        // Fling inertia
        this.viewport.inertiaPan(this.panVelocity.vx, this.panVelocity.vy);
      }
    }

    this.isPointerDown = false;
    this.isPanning = false;
    this.panVelocity = { vx: 0, vy: 0 };
  };

  private onPointerCancel = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);
    if (this.activePointers.size === 0) {
      this.pinchState = null;
      if (this.draggedNode) {
        this.viewport.graph.unpinNode(this.draggedNode.id);
        this.draggedNode = null;
      }
      this.isPointerDown = false;
      this.isPanning = false;
      this.panVelocity = { vx: 0, vy: 0 };
    }
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
    window.removeEventListener('pointercancel', this.onPointerCancel);
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
