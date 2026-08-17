import {
  baseRadius,
  measureTimerResolution,
  createAppendPayload,
  productionLinkDistance,
  runDragWorkload,
  runGraphWorkload,
  type DragWorkloadResult,
  type GraphWorkloadResult,
  type PhysicsGraph,
  type PhysicsLayout,
  type PhysicsLink,
  type PhysicsNode,
} from './physics';

export interface ProductionLayoutOptions {
  repulsion: (node: PhysicsNode, index: number) => number;
  collisionRadius: (node: PhysicsNode, index: number) => number;
  collisionStrength: number;
  linkDistance: (link: Pick<PhysicsLink, 'source' | 'target'>, index: number) => number;
  linkStrength: number;
  centerStrength: number;
  velocityDecay: number;
  alphaDecay: number;
  repulsionDistanceMax: number;
  seed: number;
}

export interface ForceLayoutConstructor {
  new (options: ProductionLayoutOptions): PhysicsLayout;
}

export type PhysicsBrowserRequest =
  | {
      kind: 'graph';
      graph: PhysicsGraph;
      appendRootId: string;
      warmupTicks: number;
      measuredTicks: number;
    }
  | { kind: 'drag'; graph: PhysicsGraph; draggedNodeId?: string };

export type PhysicsBrowserResult =
  | {
      kind: 'graph';
      timerResolutionMilliseconds: number;
      metrics: GraphWorkloadResult;
    }
  | {
      kind: 'drag';
      timerResolutionMilliseconds: number;
      metrics: DragWorkloadResult;
    };

export function createProductionLayoutOptions(
  graph: PhysicsGraph,
  additionalNodes: readonly PhysicsNode[] = [],
): ProductionLayoutOptions {
  const nodes = [...graph.nodes, ...additionalNodes];
  return {
    repulsion: (node) => baseRadius(node.type) * 11 + 95,
    collisionRadius: (node) => baseRadius(node.type) + 14,
    collisionStrength: 0.7,
    linkDistance: (link) => productionLinkDistance(link, nodes),
    linkStrength: 0.42,
    centerStrength: 0.016,
    velocityDecay: 0.64,
    alphaDecay: 0.024,
    repulsionDistanceMax: 450,
    seed: 7,
  };
}

export async function runPhysicsBrowserWorkload(
  Layout: ForceLayoutConstructor,
  request: PhysicsBrowserRequest,
  dependencies: {
    now?: () => number;
    yieldTask?: () => Promise<void>;
    timerReads?: number;
  } = {},
): Promise<PhysicsBrowserResult> {
  const now = dependencies.now ?? (() => performance.now());
  const yieldTask =
    dependencies.yieldTask ?? (() => new Promise((resolve) => setTimeout(resolve, 0)));
  const timerResolutionMilliseconds = measureTimerResolution(now, dependencies.timerReads ?? 10000);
  const appendedNodes =
    request.kind === 'graph' ? createAppendPayload(request.graph, request.appendRootId).nodes : [];
  const layoutOptions = createProductionLayoutOptions(request.graph, appendedNodes);
  const layout = new Layout(layoutOptions);

  if (request.kind === 'graph') {
    return {
      kind: 'graph',
      timerResolutionMilliseconds,
      metrics: await runGraphWorkload({ ...request, layout, now, yieldTask }),
    };
  }
  return {
    kind: 'drag',
    timerResolutionMilliseconds,
    metrics: await runDragWorkload({ ...request, layout, now, yieldTask }),
  };
}
