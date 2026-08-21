import type { App } from '../App';

export interface OmmInstrumentationRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OmmInstrumentationTarget {
  id: string;
  rect: OmmInstrumentationRect;
}

interface InstrumentationOwner {
  canvas: { width: number; height: number };
  scene: { width: number; height: number };
  viewport: App['viewport'];
  drawer: App['drawer'];
  headerBar: App['headerBar'];
  controls: App['controls'];
  relationshipFilterBar: App['relationshipFilterBar'];
  graphStatsPanel: App['graphStatsPanel'];
  minimap: App['minimap'];
  graphClearControl: App['graphClearControl'];
  graphHistoryControls: App['graphHistoryControls'];
  visibilityManager: App['visibilityManager'];
  isReady: App['isReady'];
  getPointerOwnershipSummary: App['getPointerOwnershipSummary'];
  isSceneAlive: App['isSceneAlive'];
  isEventOverUI: App['isEventOverUI'];
  getNodeAtScreenPoint: App['getNodeAtScreenPoint'];
}

function copyTarget(target: OmmInstrumentationTarget): OmmInstrumentationTarget {
  return { id: target.id, rect: { ...target.rect } };
}

export class OmmAppInstrumentation {
  constructor(private readonly app: InstrumentationOwner) {}

  get ready(): boolean {
    return this.app.isReady() && this.app.viewport.getNodes().length > 0;
  }

  get animationFree(): boolean {
    return (
      !this.app.viewport.isPhysicsActive() &&
      !this.app.viewport.isCameraAnimating() &&
      !this.app.drawer.hasPendingAnimations()
    );
  }

  get animationDiagnostics(): {
    physicsActive: boolean;
    cameraAnimating: boolean;
    drawerAnimating: boolean;
  } {
    return {
      physicsActive: this.app.viewport.isPhysicsActive(),
      cameraAnimating: this.app.viewport.isCameraAnimating(),
      drawerAnimating: this.app.drawer.hasPendingAnimations(),
    };
  }

  get sceneAlive(): boolean {
    return this.app.isSceneAlive();
  }

  get camera(): { panX: number; panY: number; zoom: number } {
    return {
      panX: this.app.viewport.panX,
      panY: this.app.viewport.panY,
      zoom: this.app.viewport.zoom,
    };
  }

  get dimensions(): {
    logical: { width: number; height: number };
    backing: { width: number; height: number };
    scale: { x: number; y: number };
  } {
    const logical = { width: this.app.scene.width, height: this.app.scene.height };
    const backing = { width: this.app.canvas.width, height: this.app.canvas.height };
    return {
      logical,
      backing,
      scale: {
        x: logical.width > 0 ? backing.width / logical.width : 0,
        y: logical.height > 0 ? backing.height / logical.height : 0,
      },
    };
  }

  get graph(): { nodeCount: number; linkCount: number; hiddenNodeCount: number } {
    return {
      nodeCount: this.app.viewport.getNodes().length,
      linkCount: this.app.viewport.getLinks().length,
      hiddenNodeCount: this.app.viewport.getHiddenNodes().length,
    };
  }

  get nodeCenters(): readonly {
    id: string;
    world: { x: number; y: number };
    screen: { x: number; y: number };
  }[] {
    return this.app.viewport.getNodes().map((node) => {
      const world = { x: node.x ?? 0, y: node.y ?? 0 };
      return { id: node.id, world, screen: this.app.viewport.worldToScreen(world.x, world.y) };
    });
  }

  get pointerOwnership(): ReturnType<App['getPointerOwnershipSummary']> {
    return this.app.getPointerOwnershipSummary();
  }

  get targets(): readonly OmmInstrumentationTarget[] {
    const targets = [
      ...this.app.headerBar.getInstrumentationTargets(),
      ...this.app.relationshipFilterBar.getInstrumentationTargets(),
      ...this.app.graphStatsPanel.getInstrumentationTargets(),
      ...this.app.graphHistoryControls.getInstrumentationTargets(),
      ...this.app.controls.getInstrumentationTargets(),
      ...this.app.drawer.getInstrumentationTargets(),
    ];
    const optionalTargets = [
      this.app.minimap.getInstrumentationTarget(),
      this.app.graphClearControl.getInstrumentationTarget(),
      this.app.visibilityManager.getInstrumentationTarget(),
    ];
    for (const target of optionalTargets) if (target) targets.push(target);
    return targets.map(copyTarget);
  }

  getTarget(id: string): OmmInstrumentationTarget | null {
    const target = this.targets.find((candidate) => candidate.id === id);
    return target ? copyTarget(target) : null;
  }

  hitTest(x: number, y: number): { overUI: boolean; nodeId: string | null } {
    return {
      overUI: this.app.isEventOverUI(x, y),
      nodeId: this.app.getNodeAtScreenPoint(x, y)?.id ?? null,
    };
  }

  get drawer(): ReturnType<App['drawer']['getInstrumentationState']> {
    return this.app.drawer.getInstrumentationState();
  }

  get tools(): {
    relationship: ReturnType<App['relationshipFilterBar']['getInstrumentationState']>;
    statsOpen: boolean;
    visibilityOpen: boolean;
    historyCount: number;
    clearArmed: boolean;
    physicsFrozen: boolean;
  } {
    return {
      relationship: this.app.relationshipFilterBar.getInstrumentationState(),
      statsOpen: this.app.graphStatsPanel.isPanelOpen(),
      visibilityOpen: this.app.visibilityManager.isPanelOpen(),
      historyCount: this.app.graphHistoryControls.getInstrumentationState().count,
      clearArmed: this.app.graphClearControl.getInstrumentationState().armed,
      physicsFrozen: this.app.viewport.isPhysicsFrozen(),
    };
  }
}

export function createOmmAppInstrumentation(app: InstrumentationOwner): OmmAppInstrumentation {
  return new OmmAppInstrumentation(app);
}
