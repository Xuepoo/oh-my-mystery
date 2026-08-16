import { Scene } from '@vectojs/core';
import type { ChronicleStep, EntityDetailResponse, OmmEntity, PathfinderResult } from '@omm/shared';
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
import { NodeRadialMenu } from './ui/NodeRadialMenu';
import { PathfinderModal } from './ui/PathfinderModal';
import { pickNodeLabel } from './scene/types';
import { getEventCoords } from './ui/theme';
import { Theme } from './ui/theme';
import { ViewportControls } from './ui/ViewportControls';
import { WelcomeLayer } from './ui/WelcomeLayer';
import { RenderSettingsModal } from './ui/RenderSettingsModal';
import { RelationshipFilterBar } from './ui/RelationshipFilterBar';
import { GraphHistoryControls } from './ui/GraphHistoryControls';
import { VisibilityManager } from './ui/VisibilityManager';
import { GraphStatsPanel } from './ui/GraphStatsPanel';
import { GraphClearControl } from './ui/GraphClearControl';
import { loadRenderSettings, measureDisplayRefresh, saveRenderSettings } from './render-settings';
import type { RenderSettings } from './render-settings';
import { loadNodeStyleSettings, saveNodeStyleSettings } from './node-style-settings';
import type { NodeStyleSettings } from './node-style-settings';
import { NodeAppearanceModal } from './ui/NodeAppearanceModal';
import { clearSession, loadSession, saveSession, type GraphSessionSnapshot } from './session';

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
  readonly radialMenu: NodeRadialMenu;
  readonly renderSettingsModal: RenderSettingsModal;
  readonly relationshipFilterBar: RelationshipFilterBar;
  readonly graphHistoryControls: GraphHistoryControls;
  readonly visibilityManager: VisibilityManager;
  readonly graphStatsPanel: GraphStatsPanel;
  readonly nodeAppearanceModal: NodeAppearanceModal;
  readonly graphClearControl: GraphClearControl;

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
  private lastActivityAt = performance.now();
  private static readonly IDLE_AMBIENT_MS = 6000;
  private pendingNodeClick: ReturnType<typeof setTimeout> | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTouchTap: { id: string; at: number; x: number; y: number } | null = null;
  private touchGestureConsumed = false;
  private renderSettings: RenderSettings;
  private displayHz = 60;
  private expansionHistory: string[] = [];
  private endpointSource: { id: string; name: string } | null = null;
  private endpointTarget: { id: string; name: string } | null = null;
  private endpointEpoch = 0;
  private modifiedPointerDown = false;
  private pathStatus: 'idle' | 'source' | 'loading' | 'success' | 'noPath' | 'failure' = 'idle';
  private nodeStyleSettings: NodeStyleSettings;
  private sessionRestore: GraphSessionSnapshot | null = null;
  private sessionSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionSavingEnabled = true;

  // The scene renders on demand; it stays awake while the user is interacting,
  // the physics sim is running, or the camera is animating — plus a short
  // ambient tail so the background animation fades out gracefully.
  public isSceneAlive(): boolean {
    return (
      performance.now() - this.lastActivityAt < App.IDLE_AMBIENT_MS ||
      this.viewport.isCameraAnimating() ||
      this.viewport.isPhysicsActive()
    );
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // The canvas owns the whole surface: disable native browser touch
    // gestures (page pinch-zoom / scroll) so pointer events stay ours.
    this.canvas.style.touchAction = 'none';
    this.source = new D1DataSource(import.meta.env.VITE_API_URL || '');
    this.renderSettings = loadRenderSettings();
    this.nodeStyleSettings = loadNodeStyleSettings();

    // 1. Initialize Single VectoJS Scene
    this.scene = new Scene(this.canvas, {
      pointBackend: this.renderSettings.pointBackend,
      particleBackend: this.renderSettings.particleBackend,
      maxFPS: this.renderSettings.fps === 120 ? 120 : 60,
      renderMode: 'onDemand',
      contentProjection: false,
    });
    this.scene.resize(window.innerWidth, window.innerHeight);

    // 2. Initialize 2D Knowledge Graph Viewport
    this.viewport = new GraphViewport({
      source: this.source,
      styleSettings: this.nodeStyleSettings,
      onChange: () => {
        this.scene.markDirty();
        this.scheduleSessionSave();
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
    this.background = new BackgroundLayer({ isAlive: () => this.isSceneAlive() });
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
        void this.addAndFocusSearchNode(id);
      },
      onFilterChange: (types) => {
        this.overlayLayer.setActiveFilter(types);
        this.scheduleSessionSave();
      },
      onToggleFullscreen: () => {
        this.toggleFullscreen();
      },
      onOpenSettings: () => {
        this.renderSettingsModal.open(this.displayHz);
      },
    });
    this.scene.add(this.headerBar);

    this.drawer = new CasefileDrawer({
      onClose: () => {
        this.activeEntityDetails = null;
        this.controls?.setVisible(true);
      },
      onSelectEntity: (id) => {
        void this.handleSelectNode(id);
      },
      onStartPathfinder: (id, name) => {
        this.drawer.close();
        this.pathfinderModal.open({ id, name });
      },
      onExpandNode: (id) => {
        void this.toggleNodeExpansion(id);
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
      onPathResult: (result) => {
        this.materializePath(result);
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
      onVisibilityChange: () => this.syncWelcomeBarrier(),
    });
    this.scene.add(this.welcomeLayer);

    this.minimap = new Minimap(this.viewport);
    this.scene.add(this.minimap);

    this.controls = new ViewportControls(this.viewport);
    this.scene.add(this.controls);

    this.renderSettingsModal = new RenderSettingsModal(
      this.renderSettings,
      (settings, backendChanged) => {
        this.renderSettings = settings;
        saveRenderSettings(settings);
        if (backendChanged) {
          window.location.reload();
          return;
        }
        this.scene.maxFPS = settings.fps === 'max' ? this.displayHz : settings.fps;
      },
      () => this.nodeAppearanceModal.open(),
      () => this.clearPersistedSession(),
    );
    this.scene.add(this.renderSettingsModal);

    this.nodeAppearanceModal = new NodeAppearanceModal(this.nodeStyleSettings, (settings) => {
      this.nodeStyleSettings = settings;
      saveNodeStyleSettings(settings);
      this.viewport.applyStyleSettings(settings);
    });
    this.scene.add(this.nodeAppearanceModal);

    this.relationshipFilterBar = new RelationshipFilterBar(this.viewport, (predicates) => {
      this.overlayLayer.setActivePredicates(predicates);
      this.scheduleSessionSave();
    });
    this.scene.add(this.relationshipFilterBar);

    this.graphHistoryControls = new GraphHistoryControls(() => this.undoLastExpansion());
    this.scene.add(this.graphHistoryControls);

    this.visibilityManager = new VisibilityManager(this.viewport);
    this.scene.add(this.visibilityManager);

    this.graphStatsPanel = new GraphStatsPanel(this.source, this.viewport);
    this.scene.add(this.graphStatsPanel);

    this.graphClearControl = new GraphClearControl(() => this.clearCanvas());
    this.scene.add(this.graphClearControl);

    this.radialMenu = new NodeRadialMenu({
      isPinned: (id) => this.viewport.isNodePinned(id),
      isExpanded: (id) => this.viewport.isNodeExpanded(id),
      canLoadMore: (id) => this.viewport.canLoadMore(id),
      onAction: (action, node) => {
        if (action === 'pin') {
          this.viewport.toggleNodePinned(node.id);
        } else if (action === 'hide') {
          if (this.activeEntityDetails?.entity.id === node.id) this.drawer.close();
          this.overlayLayer.setHoveredEntity(null);
          if (this.viewport.hideNode(node.id)) {
            this.expansionHistory = this.expansionHistory.filter((entry) => entry !== node.id);
            this.graphHistoryControls.setCount(this.expansionHistory.length);
          }
        } else if (action === 'expand') {
          void this.toggleNodeExpansion(node.id);
        } else if (action === 'layout') {
          this.viewport.relayoutAround(node.id);
        } else {
          void this.handleSelectNode(node.id, {
            x: node.sx ?? node.x ?? 0,
            y: node.sy ?? node.y ?? 0,
          });
        }
      },
    });
    this.scene.add(this.radialMenu);

    this.syncWelcomeBarrier();

    // 4. Bind Native Canvas Pointer Interactions
    this.setupInteractions();

    // 5. Handle Window Resize
    window.addEventListener('resize', this.onResize);
  }

  private isEventOverUI(x: number, y: number): boolean {
    return (
      this.headerBar.isPointInside(x, y) ||
      this.welcomeLayer.isPointInside(x, y) ||
      this.drawer.isPointInside(x, y) ||
      this.chroniclePanel.isPointInside(x, y) ||
      this.pathfinderModal.isPointInside(x, y) ||
      this.renderSettingsModal.isPointInside(x, y) ||
      this.nodeAppearanceModal.isPointInside(x, y) ||
      this.relationshipFilterBar.isPointInside(x, y) ||
      this.graphHistoryControls.isPointInside(x, y) ||
      this.visibilityManager.isPointInside(x, y) ||
      this.graphStatsPanel.isPointInside(x, y) ||
      this.graphClearControl.isPointInside(x, y) ||
      this.minimap.isPointInside(x, y) ||
      this.controls.isPointInside(x, y) ||
      this.radialMenu.isPointInside(x, y)
    );
  }

  private setupInteractions(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return;
      const { x, y } = getEventCoords(e);
      const modified = (e.ctrlKey || e.metaKey) && e.button === 0;
      const modifiedNode =
        modified && !this.isEventOverUI(x, y) ? this.overlayLayer.getNodeAtScreenPoint(x, y) : null;
      if (modified && modifiedNode) {
        e.preventDefault();
        this.cancelLongPress();
        if (this.pendingNodeClick) {
          clearTimeout(this.pendingNodeClick);
          this.pendingNodeClick = null;
        }
        this.modifiedPointerDown = true;
        this.activePointers.set(e.pointerId, { x, y });
        this.isPointerDown = false;
        this.isPanning = false;
        this.draggedNode = null;
        void this.selectPathEndpoint(modifiedNode.id, modifiedNode.name);
        return;
      }
      this.modifiedPointerDown = false;
      this.cancelLongPress();
      this.touchGestureConsumed = false;
      this.pointerDownPos = { x, y };
      this.lastPointerPos = { x, y };
      this.isPointerDown = true;
      this.lastPanTime = performance.now();
      this.lastActivityAt = this.lastPanTime;
      this.panVelocity = { vx: 0, vy: 0 };
      this.activePointers.set(e.pointerId, { x, y });

      if (this.activePointers.size >= 2) {
        // Second finger lands: switch to pinch gesture
        this.cancelLongPress();
        this.touchGestureConsumed = true;
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

      if (this.welcomeLayer.isVisible() && this.welcomeLayer.isPointInside(x, y)) {
        if (this.helpModal.isModalOpen()) {
          this.helpModal.handleClick(x, y);
          return;
        }
        if (this.headerBar.isPointInside(x, y)) {
          this.headerBar.handleClick(x, y);
          return;
        }
        this.welcomeLayer.handleClick(x, y);
        return;
      }

      // 1. Dispatch to UI Panels (Highest overlay priority first)
      if (this.radialMenu.isMenuOpen()) {
        if (!this.radialMenu.handleClick(x, y)) this.radialMenu.close();
        return;
      }
      if (this.renderSettingsModal.isModalOpen()) {
        this.renderSettingsModal.handleClick(x, y);
        return;
      }
      if (this.nodeAppearanceModal.isModalOpen()) {
        this.nodeAppearanceModal.handleClick(x, y);
        return;
      }
      if (this.visibilityManager.isPanelOpen()) {
        this.visibilityManager.handleClick(x, y);
        return;
      }
      if (this.graphStatsPanel.isPanelOpen()) {
        this.graphStatsPanel.handleClick(x, y);
        return;
      }
      if (this.relationshipFilterBar.isPointInside(x, y)) {
        this.relationshipFilterBar.handleClick(x, y);
        return;
      }
      if (this.graphHistoryControls.isPointInside(x, y)) {
        this.graphHistoryControls.handleClick(x, y);
        return;
      }
      if (this.visibilityManager.isPointInside(x, y)) {
        this.visibilityManager.handleClick(x, y);
        return;
      }
      if (this.graphStatsPanel.isPointInside(x, y)) {
        this.graphStatsPanel.handleClick(x, y);
        return;
      }
      if (this.graphClearControl.isPointInside(x, y)) {
        this.graphClearControl.handleClick(x, y);
        return;
      }
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
        if (this.drawer.handlePointerDown(x, y)) return;
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
        if (e.pointerType === 'touch') {
          this.longPressTimer = setTimeout(() => {
            this.longPressTimer = null;
            if (!this.draggedNode || this.draggedNode.id !== hitNode.id || this.pinchState) return;
            this.touchGestureConsumed = true;
            this.lastTouchTap = null;
            if (this.pendingNodeClick) {
              clearTimeout(this.pendingNodeClick);
              this.pendingNodeClick = null;
            }
            this.viewport.graph.unpinNode(hitNode.id);
            this.draggedNode = null;
            this.radialMenu.open(hitNode, x, y);
          }, 550);
        }
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
    this.canvas.addEventListener('dblclick', this.onCanvasDoubleClick);
  }

  private onCanvasContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    const { x, y } = getEventCoords(e);
    if (this.radialMenu.isMenuOpen()) this.radialMenu.close();
    if (this.isEventOverUI(x, y)) return;
    const node = this.overlayLayer.getNodeAtScreenPoint(x, y);
    if (node) this.radialMenu.open(node, x, y);
    else this.radialMenu.close();
  };

  private onCanvasDoubleClick = (e: MouseEvent): void => {
    const { x, y } = getEventCoords(e);
    if (this.isEventOverUI(x, y)) return;
    const node = this.overlayLayer.getNodeAtScreenPoint(x, y);
    if (!node) return;
    if (this.pendingNodeClick) {
      clearTimeout(this.pendingNodeClick);
      this.pendingNodeClick = null;
    }
    this.drawer.close();
    this.radialMenu.close();
    // Double-click is an exploration gesture. It must never remove an
    // already-loaded branch; explicit collapse remains available from the
    // radial menu and the detail card.
    if (!this.viewport.isNodeExpanded(node.id)) {
      void this.toggleNodeExpansion(node.id);
    }
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
      if (this.radialMenu.isMenuOpen()) {
        this.radialMenu.close();
        return;
      }
      if (this.visibilityManager.isPanelOpen()) {
        this.visibilityManager.close();
        return;
      }
      if (this.graphStatsPanel.isPanelOpen()) {
        this.graphStatsPanel.close();
        return;
      }
      if (this.helpModal.isModalOpen()) {
        this.helpModal.close();
        return;
      }
      if (this.renderSettingsModal.isModalOpen()) {
        this.renderSettingsModal.close();
        return;
      }
      if (this.nodeAppearanceModal.isModalOpen()) {
        this.nodeAppearanceModal.close();
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
    if (this.radialMenu.isMenuOpen()) {
      this.radialMenu.handlePointerMove(x, y);
    }
    if (this.activePointers.has(e.pointerId)) {
      this.activePointers.set(e.pointerId, { x, y });
    }
    const now = performance.now();
    if (this.drawer.handlePointerMove(x, y)) {
      this.lastActivityAt = now;
      return;
    }
    if (Math.hypot(x - this.pointerDownPos.x, y - this.pointerDownPos.y) > 8) {
      this.cancelLongPress();
    }
    this.lastActivityAt = now;
    // Wake the on-demand renderer when activity resumes after idle.
    if (this.isSceneAlive()) {
      this.scene.markDirty();
    }

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
    this.cancelLongPress();
    this.activePointers.delete(e.pointerId);
    if (this.modifiedPointerDown) {
      this.modifiedPointerDown = false;
      this.isPointerDown = false;
      this.isPanning = false;
      return;
    }

    if (this.drawer.handlePointerUp()) {
      this.isPointerDown = false;
      this.isPanning = false;
      this.panVelocity = { vx: 0, vy: 0 };
      return;
    }

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
      if (moveDist < (e.pointerType === 'touch' ? 10 : 6) && !this.touchGestureConsumed) {
        const node = this.draggedNode;
        if (e.pointerType === 'touch') {
          const now = performance.now();
          const previous = this.lastTouchTap;
          const isDoubleTap =
            previous?.id === node.id &&
            now - previous.at <= 320 &&
            Math.hypot(x - previous.x, y - previous.y) <= 28;
          if (isDoubleTap) {
            this.lastTouchTap = null;
            if (this.pendingNodeClick) {
              clearTimeout(this.pendingNodeClick);
              this.pendingNodeClick = null;
            }
            this.drawer.close();
            void this.toggleNodeExpansion(node.id);
          } else {
            this.lastTouchTap = { id: node.id, at: now, x, y };
            if (this.pendingNodeClick) clearTimeout(this.pendingNodeClick);
            this.pendingNodeClick = setTimeout(() => {
              this.pendingNodeClick = null;
              if (this.lastTouchTap?.id === node.id) this.lastTouchTap = null;
              void this.handleSelectNode(node.id, { x, y });
            }, 340);
          }
        } else {
          // Delay mouse single-click details so native dblclick can claim the gesture.
          if (this.pendingNodeClick) clearTimeout(this.pendingNodeClick);
          this.pendingNodeClick = setTimeout(() => {
            this.pendingNodeClick = null;
            void this.handleSelectNode(node.id, { x, y });
          }, 240);
        }
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
    this.cancelLongPress();
    this.touchGestureConsumed = true;
    this.modifiedPointerDown = false;
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
        this.lastActivityAt = performance.now();
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
    this.canvas.removeEventListener('dblclick', this.onCanvasDoubleClick);
    if (this.pendingNodeClick) clearTimeout(this.pendingNodeClick);
    if (this.sessionSaveTimer) clearTimeout(this.sessionSaveTimer);
    this.cancelLongPress();
    this.headerBar.dispose();
    this.pathfinderModal.dispose();
    this.nodeAppearanceModal.dispose();
    this.background.dispose();
    this.scene.stop();
  }

  private cancelLongPress(): void {
    if (!this.longPressTimer) return;
    clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
  }

  private syncWelcomeBarrier(): void {
    // Welcome is an informational card, not a modal barrier. Only its own
    // bounds own pointer events; the graph and all other tools remain usable.
    this.headerBar.setWelcomeMode(false);
    this.relationshipFilterBar.setEnabled(true);
    this.graphHistoryControls.setEnabled(true);
    this.visibilityManager.setEnabled(true);
    this.graphStatsPanel.setEnabled(true);
    this.graphClearControl.setEnabled(true);
    this.minimap.setEnabled(true);
    this.controls.setVisible(this.activeEntityDetails === null);
    this.scene.markDirty();
  }

  async start(): Promise<void> {
    this.displayHz = await measureDisplayRefresh();
    this.scene.maxFPS =
      this.renderSettings.fps === 'max' ? this.displayHz : this.renderSettings.fps;
    this.scene.start();
    await this.viewport.init();
    const session = this.sessionRestore || loadSession();
    if (session) this.restoreSession(session);
  }

  private scheduleSessionSave(): void {
    if (!this.sessionSavingEnabled) return;
    if (this.sessionSaveTimer) clearTimeout(this.sessionSaveTimer);
    this.sessionSaveTimer = setTimeout(() => {
      this.sessionSaveTimer = null;
      saveSession({
        version: 1,
        camera: { panX: this.viewport.panX, panY: this.viewport.panY, zoom: this.viewport.zoom },
        graph: this.viewport.exportSnapshot(),
        expansionHistory: [...this.expansionHistory],
        filter: this.headerBar.getActiveFilter(),
        relationshipIndexes: [...this.relationshipFilterBar.getActiveIndexes()],
        endpoints: {
          source: this.endpointSource,
          target: this.endpointTarget,
          status: this.pathStatus === 'loading' ? 'idle' : this.pathStatus,
        },
      });
    }, 250);
  }

  private restoreSession(session: GraphSessionSnapshot): void {
    this.endpointEpoch++;
    this.selectEpoch++;
    this.viewport.importSnapshot(session.graph);
    this.expansionHistory = [...session.expansionHistory].filter((id) =>
      this.viewport.isNodeExpanded(id),
    );
    this.graphHistoryControls.setCount(this.expansionHistory.length);
    this.headerBar.setActiveFilter(session.filter);
    this.relationshipFilterBar.setActiveIndexes(session.relationshipIndexes);
    this.endpointSource = session.endpoints.source;
    this.endpointTarget = session.endpoints.target;
    this.pathStatus = session.endpoints.status;
    if (this.endpointSource)
      this.pathfinderModal.setSource(this.endpointSource.id, this.endpointSource.name);
    if (this.endpointTarget)
      this.pathfinderModal.setTarget(this.endpointTarget.id, this.endpointTarget.name);
    this.viewport.setCamera(session.camera);
    this.scene.markDirty();
  }

  private clearPersistedSession(): void {
    this.sessionSavingEnabled = false;
    if (this.sessionSaveTimer) {
      clearTimeout(this.sessionSaveTimer);
      this.sessionSaveTimer = null;
    }
    clearSession();
    this.clearCanvas();
    this.sessionSavingEnabled = true;
  }

  public async handleSelectNode(id: string, anchor?: { x: number; y: number }): Promise<void> {
    const epoch = ++this.selectEpoch;
    this.scene.markDirty();
    if (!anchor) this.viewport.focusNode(id);

    const details = await this.source.fetchEntityDetails(id);
    if (epoch !== this.selectEpoch) return;
    if (details) {
      this.activeEntityDetails = details;
      const node = this.viewport.graph.getNode(id);
      const cardAnchor = anchor || {
        x: node?.sx ?? this.scene.width / 2,
        y: node?.sy ?? this.scene.height / 2,
      };
      this.drawer.open(details, cardAnchor);
      this.controls.setVisible(false);
    }
  }

  private async addAndFocusSearchNode(id: string): Promise<void> {
    const generation = this.viewport.graph.getGeneration();
    if (this.viewport.getHiddenNodes().some((node) => node.id === id)) {
      this.viewport.restoreNode(id);
    }
    if (!this.viewport.graph.getNode(id)) {
      const [node] = await this.source.getNodes([id]);
      if (generation !== this.viewport.graph.getGeneration()) return;
      if (!node) return;
      this.viewport.addManualNode(node);
    }
    this.drawer.close();
    this.viewport.ensureNodeVisible(id);
  }

  private async selectPathEndpoint(id: string, name: string): Promise<void> {
    if (this.endpointSource && this.endpointTarget) {
      this.endpointSource = { id, name };
      this.endpointTarget = null;
      this.pathStatus = 'source';
      this.endpointEpoch++;
      this.viewport.clearHighlight();
      this.scene.markDirty();
      return;
    }
    if (!this.endpointSource) {
      this.endpointSource = { id, name };
      this.pathStatus = 'source';
      this.scene.markDirty();
      return;
    }
    if (this.endpointSource.id === id) return;
    this.endpointTarget = { id, name };
    const epoch = ++this.endpointEpoch;
    this.pathStatus = 'loading';
    this.scene.markDirty();
    const result = await this.source.findPath(this.endpointSource.id, id);
    if (epoch !== this.endpointEpoch) return;
    if (!result?.found) {
      this.pathStatus = result ? 'noPath' : 'failure';
      this.scene.markDirty();
      return;
    }
    this.pathStatus = 'success';
    this.materializePath(result);
    this.pathfinderModal.setSource(this.endpointSource.id, this.endpointSource.name);
    this.pathfinderModal.setTarget(id, name);
    this.scene.markDirty();
  }

  private materializePath(result: PathfinderResult): void {
    const nodes = result.nodes.map((entity: OmmEntity) => this.entityToGraphNode(entity));
    this.viewport.addPathNodes(nodes, result.edges);
    this.viewport.highlightPath(
      nodes.map((node) => node.id),
      result.edges,
    );
  }

  private entityToGraphNode(entity: OmmEntity): GraphNode2D {
    const labels = entity.names?.labels || {};
    const name = pickNodeLabel(labels, 'zh', entity.names?.aliases) || entity.id;
    return {
      id: entity.id,
      type: entity.type,
      name,
      color: Theme.getNodeColor(entity.type),
      val: entity.type === 'author' ? 1.4 : 1,
      labels,
    };
  }

  private clearCanvas(): void {
    this.selectEpoch++;
    if (this.pendingNodeClick) {
      clearTimeout(this.pendingNodeClick);
      this.pendingNodeClick = null;
    }
    this.cancelLongPress();
    this.lastTouchTap = null;
    this.activePointers.clear();
    this.draggedNode = null;
    this.isPointerDown = false;
    this.isPanning = false;
    this.expansionHistory = [];
    this.endpointEpoch++;
    this.endpointSource = null;
    this.endpointTarget = null;
    this.pathStatus = 'idle';
    this.modifiedPointerDown = false;
    this.graphHistoryControls.setCount(0);
    this.drawer.close();
    this.radialMenu.close();
    this.visibilityManager.close();
    this.graphStatsPanel.close();
    this.pathfinderModal.close();
    this.chroniclePanel.close();
    this.overlayLayer.setHoveredEntity(null);
    this.overlayLayer.clearInteractionState();
    this.viewport.clear();
    this.controls.setVisible(true);
  }

  private async toggleNodeExpansion(id: string): Promise<void> {
    const wasExpanded = this.viewport.isNodeExpanded(id);
    const wasLoadMore = this.viewport.canLoadMore(id);
    await this.viewport.toggleNodeExpansion(id, this.relationshipFilterBar.getActivePredicates());
    if (!wasExpanded && this.viewport.isNodeExpanded(id) && !this.expansionHistory.includes(id)) {
      this.expansionHistory.push(id);
    } else if (wasExpanded && !wasLoadMore && !this.viewport.isNodeExpanded(id)) {
      this.expansionHistory = this.expansionHistory.filter((entry) => entry !== id);
    }
    this.graphHistoryControls.setCount(this.expansionHistory.length);
  }

  private undoLastExpansion(): void {
    while (this.expansionHistory.length > 0) {
      const id = this.expansionHistory.pop()!;
      if (!this.viewport.isNodeExpanded(id)) continue;
      this.viewport.collapseNode(id);
      break;
    }
    this.graphHistoryControls.setCount(this.expansionHistory.length);
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
