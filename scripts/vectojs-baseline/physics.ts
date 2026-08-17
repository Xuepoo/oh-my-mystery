import {
  collisionOverlapCount,
  displacementMetrics,
  nonFinitePositionCount,
  peakLinkLengthRatio,
  undirectedHopDistances,
  velocityDirectionChangeCount,
  type CollisionPosition,
  type MetricLink,
  type Position,
} from './graph-metrics';
import { nearestRank } from './metrics';

const maximumSettlingTicks = 2000;
const appendCount = 50;
const goldenAngle = 2.399963229728653;
const collisionPadding = 14;

export interface PhysicsNode {
  id: string;
  type: string;
  radius: number;
  x: number;
  y: number;
}

export interface PhysicsLink extends MetricLink {
  id: string;
  predicate: string;
}

export interface PhysicsGraph {
  nodes: PhysicsNode[];
  links: PhysicsLink[];
}

export interface PhysicsLayout {
  positions: Float32Array;
  nodeCount: number;
  setGraph(graph: PhysicsGraph): void;
  appendGraph(graph: PhysicsGraph): void;
  step(iterations?: number): boolean;
  getNodeIndex(id: string): number | undefined;
  getNodeIds(): readonly (string | number)[];
  pinNode(index: number, x: number, y: number): void;
  unpinNode(index: number): void;
  reheat(alpha?: number): void;
  dispose(): void;
}

export type PhysicsPhase =
  | 'construct'
  | 'warmup'
  | 'measured'
  | 'initial-settling'
  | 'initial-snapshot'
  | 'append'
  | 'first-post-append'
  | 'post-append-settling'
  | 'drag'
  | 'post-drag-settling'
  | 'final-snapshot'
  | 'dispose';

export interface PhysicsCorrectnessMetrics {
  nonFinitePositionCount: number;
  collisionOverlapCount: number;
}

export interface SettlingMetrics extends PhysicsCorrectnessMetrics {
  settlingTicks: number;
  settlingWallMilliseconds: number;
}

export interface GraphWorkloadResult {
  measured: {
    tickMilliseconds: number[];
    tickP50Milliseconds: number;
    tickP95Milliseconds: number;
    tickMaximumMilliseconds: number;
    synchronousStepsAbove50Milliseconds: number;
  };
  initial: SettlingMetrics;
  appendMutationMilliseconds: number;
  firstPostAppendMilliseconds: number;
  postAppend: SettlingMetrics & {
    oldNodeRmsDisplacement: number;
    farNodeMaximumDisplacement: number;
    peakLinkRatio: number;
  };
}

export interface DragWorkloadResult {
  initial: SettlingMetrics;
  dragPointerError: number;
  postDrag: SettlingMetrics & {
    oldNodeRmsDisplacement: number;
    farNodeMaximumDisplacement: number;
    peakLinkRatio: number;
    lateVelocityDirectionChanges: number;
  };
}

interface WorkloadDependencies {
  graph: PhysicsGraph;
  layout: PhysicsLayout;
  now: () => number;
  yieldTask: () => Promise<void>;
  onPhase?: (phase: PhysicsPhase) => void;
}

interface SettlingState {
  ticks: number;
  active: boolean;
  start?: number;
}

export async function runGraphWorkload(
  options: WorkloadDependencies & {
    appendRootId: string;
    warmupTicks: number;
    measuredTicks: number;
  },
): Promise<GraphWorkloadResult> {
  const { graph, layout, now, yieldTask, onPhase } = options;
  let disposed = false;
  try {
    phase(onPhase, 'construct');
    layout.setGraph(graph);
    const initialState: SettlingState = { ticks: 0, active: true };

    phase(onPhase, 'warmup');
    for (let index = 0; index < options.warmupTicks && initialState.active; index += 1) {
      initialState.start ??= now();
      initialState.active = stepWithinCap(layout, initialState, 'initial');
      if (initialState.active) await yieldTask();
    }

    phase(onPhase, 'measured');
    const measuredTicks: number[] = [];
    for (let index = 0; index < options.measuredTicks && initialState.active; index += 1) {
      const start = now();
      initialState.start ??= start;
      initialState.active = stepWithinCap(layout, initialState, 'initial');
      measuredTicks.push(finiteDuration(now() - start, 'measured tick'));
      await yieldTask();
    }
    if (measuredTicks.length !== options.measuredTicks) {
      throw new Error('Layout cooled before all required measured samples were recorded');
    }

    phase(onPhase, 'initial-settling');
    while (initialState.active) {
      initialState.start ??= now();
      initialState.active = stepWithinCap(layout, initialState, 'initial');
      if (initialState.active) await yieldTask();
    }
    const initialWall = finiteDuration(
      now() - (initialState.start ?? now()),
      'initial settling wall',
    );

    phase(onPhase, 'initial-snapshot');
    const initialPositions = snapshotPositions(layout);
    const initialCorrectness = correctnessMetrics(graph.nodes, initialPositions);
    const cooledRoot = initialPositions.find((position) => position.id === options.appendRootId);
    if (!cooledRoot) throw new Error(`Missing cooled append root ${options.appendRootId}`);
    const appendPayload = createAppendPayload(graph, options.appendRootId, cooledRoot);
    const allNodes = [...graph.nodes, ...appendPayload.nodes];
    const allLinks = [...graph.links, ...appendPayload.links];
    const hops = undirectedHopDistances(graph.links, options.appendRootId);

    phase(onPhase, 'append');
    const appendStart = now();
    layout.appendGraph(appendPayload);
    const appendMutationMilliseconds = finiteDuration(now() - appendStart, 'append mutation');

    phase(onPhase, 'first-post-append');
    const firstStepStart = now();
    const postAppendState: SettlingState = {
      ticks: 0,
      active: true,
      start: firstStepStart,
    };
    postAppendState.active = stepWithinCap(layout, postAppendState, 'post-append');
    const firstPostAppendMilliseconds = finiteDuration(
      now() - firstStepStart,
      'first post-append tick',
    );
    let peakRatio = peakLinkLengthRatio(snapshotPositions(layout), allLinks, (link) =>
      productionLinkDistance(link, allNodes),
    );
    if (postAppendState.active) await yieldTask();

    phase(onPhase, 'post-append-settling');
    while (postAppendState.active) {
      postAppendState.active = stepWithinCap(layout, postAppendState, 'post-append');
      peakRatio = Math.max(
        peakRatio,
        peakLinkLengthRatio(snapshotPositions(layout), allLinks, (link) =>
          productionLinkDistance(link, allNodes),
        ),
      );
      if (postAppendState.active) await yieldTask();
    }
    const postAppendWall = finiteDuration(
      now() - postAppendState.start,
      'post-append settling wall',
    );

    phase(onPhase, 'final-snapshot');
    const finalPositions = snapshotPositions(layout);
    const displacement = displacementMetrics(initialPositions, finalPositions, hops);
    const postAppendCorrectness = correctnessMetrics(allNodes, finalPositions);

    return {
      measured: measuredMetrics(measuredTicks),
      initial: {
        settlingTicks: initialState.ticks,
        settlingWallMilliseconds: initialWall,
        ...initialCorrectness,
      },
      appendMutationMilliseconds,
      firstPostAppendMilliseconds,
      postAppend: {
        settlingTicks: postAppendState.ticks,
        settlingWallMilliseconds: postAppendWall,
        oldNodeRmsDisplacement: displacement.rms,
        farNodeMaximumDisplacement: displacement.farMaximum,
        peakLinkRatio: assertFiniteMetric(peakRatio, 'peak link ratio'),
        ...postAppendCorrectness,
      },
    };
  } finally {
    if (!disposed) {
      phase(onPhase, 'dispose');
      layout.dispose();
      disposed = true;
    }
  }
}

export async function runDragWorkload(
  options: WorkloadDependencies & { draggedNodeId?: string },
): Promise<DragWorkloadResult> {
  const { graph, layout, now, yieldTask, onPhase } = options;
  const draggedNodeId = options.draggedNodeId ?? 'n0500';
  try {
    phase(onPhase, 'construct');
    layout.setGraph(graph);
    phase(onPhase, 'initial-settling');
    const initialState = await settle(layout, now, yieldTask, 'initial');

    phase(onPhase, 'initial-snapshot');
    const beforeDrag = snapshotPositions(layout);
    const initialCorrectness = correctnessMetrics(graph.nodes, beforeDrag);
    const draggedIndex = layout.getNodeIndex(draggedNodeId);
    if (draggedIndex === undefined) throw new Error(`Missing dragged node ${draggedNodeId}`);
    const startX = layout.positions[draggedIndex * 2];
    const startY = layout.positions[draggedIndex * 2 + 1];
    let pointerError = 0;

    phase(onPhase, 'drag');
    layout.pinNode(draggedIndex, startX, startY);
    layout.reheat(0.25);
    for (let sample = 1; sample <= 30; sample += 1) {
      const progress = sample / 30;
      const expectedX = startX + 160 * progress;
      const expectedY = startY + 40 * Math.sin(Math.PI * progress);
      layout.pinNode(draggedIndex, expectedX, expectedY);
      layout.reheat(0.25);
      const positions = layout.positions;
      pointerError = Math.max(
        pointerError,
        Math.hypot(
          positions[draggedIndex * 2] - expectedX,
          positions[draggedIndex * 2 + 1] - expectedY,
        ),
      );
      await yieldTask();
    }
    layout.unpinNode(draggedIndex);
    layout.reheat(0.08);

    phase(onPhase, 'post-drag-settling');
    const snapshots: Position[][] = [snapshotPositions(layout)];
    const postDragState: SettlingState = { ticks: 0, active: true };
    let peakRatio = 0;
    while (postDragState.active) {
      postDragState.start ??= now();
      postDragState.active = stepWithinCap(layout, postDragState, 'post-drag');
      const snapshot = snapshotPositions(layout);
      snapshots.push(snapshot);
      peakRatio = Math.max(
        peakRatio,
        peakLinkLengthRatio(snapshot, graph.links, (link) =>
          productionLinkDistance(link, graph.nodes),
        ),
      );
      if (postDragState.active) await yieldTask();
    }
    const postDragWall = finiteDuration(
      now() - (postDragState.start ?? now()),
      'post-drag settling wall',
    );

    phase(onPhase, 'final-snapshot');
    const finalPositions = snapshots.at(-1)!;
    const oldNodesBefore = beforeDrag.filter((position) => position.id !== draggedNodeId);
    const oldNodesAfter = finalPositions.filter((position) => position.id !== draggedNodeId);
    const hops = undirectedHopDistances(graph.links, draggedNodeId);
    const displacement = displacementMetrics(oldNodesBefore, oldNodesAfter, hops);

    return {
      initial: { ...initialState, ...initialCorrectness },
      dragPointerError: assertFiniteMetric(pointerError, 'drag pointer error'),
      postDrag: {
        settlingTicks: postDragState.ticks,
        settlingWallMilliseconds: postDragWall,
        oldNodeRmsDisplacement: displacement.rms,
        farNodeMaximumDisplacement: displacement.farMaximum,
        peakLinkRatio: assertFiniteMetric(peakRatio, 'peak link ratio'),
        lateVelocityDirectionChanges: velocityDirectionChangeCount(snapshots, draggedNodeId),
        ...correctnessMetrics(graph.nodes, finalPositions),
      },
    };
  } finally {
    phase(onPhase, 'dispose');
    layout.dispose();
  }
}

export function createAppendPayload(
  graph: PhysicsGraph,
  rootId: string,
  rootPosition?: Pick<Position, 'x' | 'y'>,
): PhysicsGraph {
  const root = graph.nodes.find((node) => node.id === rootId);
  if (!root) throw new Error(`Missing append root ${rootId}`);
  const rootX = rootPosition?.x ?? root.x;
  const rootY = rootPosition?.y ?? root.y;
  const nodes = Array.from({ length: appendCount }, (_, index): PhysicsNode => {
    const angle = index * goldenAngle;
    const distance = 45 + Math.sqrt(index) * 5;
    return {
      id: `a${String(index).padStart(4, '0')}`,
      type: 'work',
      radius: 5.5,
      x: rootX + Math.cos(angle) * distance,
      y: rootY + Math.sin(angle) * distance,
    };
  });
  const links: PhysicsLink[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    links.push({
      id: `${rootId}|related|${node.id}`,
      source: rootId,
      target: node.id,
      predicate: 'related',
    });
    const ordinal = index + 1;
    if (ordinal > 1 && ordinal % 5 === 0) {
      const previous = nodes[index - 1];
      links.push({
        id: `${previous.id}|related|${node.id}`,
        source: previous.id,
        target: node.id,
        predicate: 'related',
      });
    }
  }
  return { nodes, links };
}

export function productionLinkDistance(link: MetricLink, nodes?: readonly PhysicsNode[]): number {
  if (!nodes) return 56.5;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const source = byId.get(link.source);
  const target = byId.get(link.target);
  if (!source || !target) throw new Error(`Missing endpoint for ${link.source} -> ${link.target}`);
  const radii = baseRadius(source.type) + baseRadius(target.type);
  if (source.type === 'author' && target.type === 'work') return 30 + radii * 1.3;
  if (source.type === 'author' && target.type === 'character') return 34 + radii * 1.4;
  return 40 + radii * 1.5;
}

export function measureTimerResolution(now: () => number, reads = 10000): number {
  if (!Number.isInteger(reads) || reads < 2)
    throw new RangeError('Timer reads must be at least two');
  let previous = now();
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < reads; index += 1) {
    const current = now();
    const delta = current - previous;
    if (delta > 0 && Number.isFinite(delta)) minimum = Math.min(minimum, delta);
    previous = current;
  }
  if (!Number.isFinite(minimum)) throw new Error('Timer did not produce a positive timer delta');
  return minimum;
}

export function baseRadius(type: string): number {
  switch (type) {
    case 'author':
      return 9;
    case 'work':
      return 5.5;
    case 'publisher':
    case 'series':
      return 5;
    case 'award':
      return 7.5;
    case 'character':
      return 6.5;
    default:
      return 5;
  }
}

function measuredMetrics(ticks: readonly number[]): GraphWorkloadResult['measured'] {
  if (ticks.length === 0) {
    return {
      tickMilliseconds: [],
      tickP50Milliseconds: 0,
      tickP95Milliseconds: 0,
      tickMaximumMilliseconds: 0,
      synchronousStepsAbove50Milliseconds: 0,
    };
  }
  return {
    tickMilliseconds: [...ticks],
    tickP50Milliseconds: nearestRank(ticks, 0.5),
    tickP95Milliseconds: nearestRank(ticks, 0.95),
    tickMaximumMilliseconds: Math.max(...ticks),
    synchronousStepsAbove50Milliseconds: ticks.filter((tick) => tick >= 50).length,
  };
}

async function settle(
  layout: PhysicsLayout,
  now: () => number,
  yieldTask: () => Promise<void>,
  name: 'initial' | 'post-append' | 'post-drag',
): Promise<SettlingMetrics> {
  const state: SettlingState = { ticks: 0, active: true };
  while (state.active) {
    state.start ??= now();
    state.active = stepWithinCap(layout, state, name);
    if (state.active) await yieldTask();
  }
  return {
    settlingTicks: state.ticks,
    settlingWallMilliseconds: finiteDuration(
      now() - (state.start ?? now()),
      `${name} settling wall`,
    ),
    nonFinitePositionCount: 0,
    collisionOverlapCount: 0,
  };
}

function stepWithinCap(
  layout: PhysicsLayout,
  state: SettlingState,
  name: 'initial' | 'post-append' | 'post-drag',
): boolean {
  const active = layout.step(1);
  state.ticks += 1;
  if (active && state.ticks >= maximumSettlingTicks) {
    throw new Error(`Layout reached the 2,000-tick ${name} settling cap while still active`);
  }
  return active;
}

function snapshotPositions(layout: PhysicsLayout): Position[] {
  const ids = layout.getNodeIds();
  const positions = layout.positions;
  if (ids.length !== layout.nodeCount || positions.length < ids.length * 2) {
    throw new Error('Layout position view does not match its node IDs');
  }
  return ids.map((id, index) => ({
    id: String(id),
    x: positions[index * 2],
    y: positions[index * 2 + 1],
  }));
}

function correctnessMetrics(
  nodes: readonly PhysicsNode[],
  positions: readonly Position[],
): PhysicsCorrectnessMetrics {
  const radii = new Map(nodes.map((node) => [node.id, baseRadius(node.type) + collisionPadding]));
  const collisionPositions: CollisionPosition[] = positions.map((position) => {
    const radius = radii.get(position.id);
    if (radius === undefined) throw new Error(`Missing collision radius for ${position.id}`);
    return { ...position, radius };
  });
  return {
    nonFinitePositionCount: nonFinitePositionCount(positions),
    collisionOverlapCount: collisionOverlapCount(collisionPositions, 1),
  };
}

function finiteDuration(duration: number, name: string): number {
  if (!Number.isFinite(duration) || duration < 0) throw new Error(`Non-finite ${name} duration`);
  return duration;
}

function assertFiniteMetric(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`Non-finite ${name}`);
  return value;
}

function phase(listener: WorkloadDependencies['onPhase'], name: PhysicsPhase): void {
  listener?.(name);
}
