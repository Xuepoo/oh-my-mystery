import { describe, expect, it } from 'bun:test';
import { createOmmAppInstrumentation } from './omm-app-instrumentation';

const rect = { x: 10, y: 20, w: 30, h: 40 };

function createOwner() {
  const node = { id: 'wd:Q347412', x: 5, y: 7 };
  return {
    canvas: { width: 1600, height: 1000 },
    scene: { width: 800, height: 500 },
    viewport: {
      panX: 11,
      panY: 12,
      zoom: 1.5,
      getNodes: () => [node],
      getLinks: () => [{ source: 'a', target: 'b' }],
      worldToScreen: (x: number, y: number) => ({ x: x + 100, y: y + 200 }),
      isPhysicsActive: () => false,
      isCameraAnimating: () => false,
      isPhysicsFrozen: () => true,
      getHiddenNodes: () => [{ id: 'hidden' }],
    },
    drawer: {
      hasPendingAnimations: () => false,
      getInstrumentationState: () => ({
        open: true,
        dragging: false,
        entityId: node.id,
        activeTab: 'profile' as const,
        profileStatus: 'ready',
        relationsStatus: 'idle',
        recommendationsStatus: 'idle',
      }),
      getInstrumentationTargets: () => [{ id: 'casefile.close', rect }],
    },
    headerBar: {
      getInstrumentationTargets: () => [{ id: 'header.search', rect }],
    },
    controls: {
      getInstrumentationTargets: () => [{ id: 'viewport.fit', rect }],
    },
    relationshipFilterBar: {
      getInstrumentationState: () => ({ expanded: true, activeIndexes: [1] }),
      getInstrumentationTargets: () => [{ id: 'tool.relationship', rect }],
    },
    graphStatsPanel: {
      isPanelOpen: () => true,
      getInstrumentationTargets: () => [{ id: 'tool.stats', rect }],
    },
    minimap: { getInstrumentationTarget: () => ({ id: 'tool.minimap', rect }) },
    graphClearControl: {
      getInstrumentationState: () => ({ armed: false }),
      getInstrumentationTarget: () => ({ id: 'tool.clear', rect }),
    },
    graphHistoryControls: {
      getInstrumentationState: () => ({ count: 2 }),
      getInstrumentationTargets: () => [{ id: 'tool.history.undo', rect }],
    },
    visibilityManager: {
      isPanelOpen: () => false,
      getInstrumentationTarget: () => ({ id: 'tool.visibility', rect }),
    },
    isReady: () => true,
    getPointerOwnershipSummary: () => ({
      activePointerIds: [3],
      canvasCapturedPointerIds: [3],
      drawerPointerId: null,
      nodePointerId: 3,
      panning: false,
      pinching: false,
      pendingClick: false,
      longPressPending: false,
    }),
    isEventOverUI: (x: number) => x === 10,
    getNodeAtScreenPoint: (x: number) => (x === 105 ? node : null),
  };
}

describe('OMM app instrumentation', () => {
  it('reports readiness, settled state, dimensions, camera, counts, and node centers', () => {
    const instrumentation = createOmmAppInstrumentation(createOwner());

    expect(instrumentation.ready).toBe(true);
    expect(instrumentation.animationFree).toBe(true);
    expect(instrumentation.camera).toEqual({ panX: 11, panY: 12, zoom: 1.5 });
    expect(instrumentation.dimensions).toEqual({
      logical: { width: 800, height: 500 },
      backing: { width: 1600, height: 1000 },
      scale: { x: 2, y: 2 },
    });
    expect(instrumentation.graph).toEqual({ nodeCount: 1, linkCount: 1, hiddenNodeCount: 1 });
    expect(instrumentation.nodeCenters).toEqual([
      { id: 'wd:Q347412', world: { x: 5, y: 7 }, screen: { x: 105, y: 207 } },
    ]);
  });

  it('returns copied stable targets and read-only hit and owner summaries', () => {
    const owner = createOwner();
    const instrumentation = createOmmAppInstrumentation(owner);

    const target = instrumentation.getTarget('viewport.fit');
    expect(target).toEqual({ id: 'viewport.fit', rect });
    target!.rect.x = 999;
    expect(instrumentation.getTarget('viewport.fit')!.rect.x).toBe(10);
    expect(instrumentation.hitTest(105, 20)).toEqual({ overUI: false, nodeId: 'wd:Q347412' });
    expect(instrumentation.pointerOwnership.nodePointerId).toBe(3);
  });

  it('reports drawer and tool state without exposing owners', () => {
    const instrumentation = createOmmAppInstrumentation(createOwner());

    expect(instrumentation.drawer.open).toBe(true);
    expect(instrumentation.tools).toEqual({
      relationship: { expanded: true, activeIndexes: [1] },
      statsOpen: true,
      visibilityOpen: false,
      historyCount: 2,
      clearArmed: false,
      physicsFrozen: true,
    });
  });
});
