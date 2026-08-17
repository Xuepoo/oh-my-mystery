import { describe, expect, test } from 'bun:test';
import {
  createAppendPayload,
  measureTimerResolution,
  runDragWorkload,
  runGraphWorkload,
  type PhysicsGraph,
  type PhysicsLayout,
} from './physics';

const graph: PhysicsGraph = {
  nodes: [
    { id: 'n0000', type: 'author', radius: 9, x: 0, y: 0 },
    { id: 'n0001', type: 'work', radius: 5.5, x: 20, y: 0 },
    { id: 'n0002', type: 'work', radius: 5.5, x: 40, y: 0 },
    { id: 'n0003', type: 'work', radius: 5.5, x: 60, y: 0 },
  ],
  links: [
    { id: 'l0', source: 'n0000', target: 'n0001', predicate: 'related' },
    { id: 'l1', source: 'n0001', target: 'n0002', predicate: 'related' },
    { id: 'l2', source: 'n0002', target: 'n0003', predicate: 'related' },
  ],
};

class FakeClock {
  value = 0;

  now = (): number => this.value;

  advance(milliseconds: number): void {
    this.value += milliseconds;
  }
}

class FakeLayout implements PhysicsLayout {
  positions = new Float32Array(graph.nodes.flatMap((node) => [node.x, node.y]));
  nodeCount = graph.nodes.length;
  readonly calls: string[] = [];
  readonly ids = graph.nodes.map((node) => node.id);
  appendedPayload?: PhysicsGraph;
  stepIndex = 0;

  constructor(
    private readonly clock: FakeClock,
    private readonly active: readonly boolean[],
    private readonly stepDurations: readonly number[],
  ) {}

  setGraph(): void {
    this.calls.push('setGraph');
  }

  appendGraph(payload: PhysicsGraph): void {
    this.calls.push(`append:${payload.nodes.length}`);
    this.appendedPayload = payload;
    this.clock.advance(7);
    this.ids.push(...payload.nodes.map((node) => node.id));
    this.nodeCount = this.ids.length;
    this.positions = new Float32Array([
      ...this.positions,
      ...payload.nodes.flatMap((node) => [node.x, node.y]),
    ]);
  }

  step(): boolean {
    this.calls.push(`step:${this.stepIndex}`);
    this.clock.advance(this.stepDurations[this.stepIndex] ?? 1);
    const active = this.active[this.stepIndex] ?? false;
    this.stepIndex += 1;
    return active;
  }

  getNodeIndex(id: string): number | undefined {
    const index = this.ids.indexOf(id);
    return index < 0 ? undefined : index;
  }

  getNodeIds(): readonly string[] {
    return [...this.ids];
  }

  pinNode(index: number, x: number, y: number): void {
    this.calls.push(`pin:${index}:${x}:${y}`);
    this.positions[index * 2] = x;
    this.positions[index * 2 + 1] = y;
  }

  unpinNode(index: number): void {
    this.calls.push(`unpin:${index}`);
  }

  reheat(alpha: number): void {
    this.calls.push(`reheat:${alpha}`);
  }

  dispose(): void {
    this.calls.push('dispose');
  }
}

describe('graph workload orchestration', () => {
  test('runs phases in order with synchronous timing boundaries and active-step yields', async () => {
    const clock = new FakeClock();
    const layout = new FakeLayout(
      clock,
      [true, true, true, true, false, true, false],
      [1, 2, 3, 4, 5, 6, 7],
    );
    const events: string[] = [];
    const result = await runGraphWorkload({
      graph,
      appendRootId: 'n0000',
      warmupTicks: 1,
      measuredTicks: 2,
      layout,
      now: clock.now,
      yieldTask: async () => {
        events.push(`yield:${layout.stepIndex}`);
        clock.advance(10);
      },
      onPhase: (phase) => events.push(phase),
    });

    expect(events).toEqual([
      'construct',
      'warmup',
      'yield:1',
      'measured',
      'yield:2',
      'yield:3',
      'initial-settling',
      'yield:4',
      'initial-snapshot',
      'append',
      'first-post-append',
      'yield:6',
      'post-append-settling',
      'final-snapshot',
      'dispose',
    ]);
    expect(layout.calls).toEqual([
      'setGraph',
      'step:0',
      'step:1',
      'step:2',
      'step:3',
      'step:4',
      'append:50',
      'step:5',
      'step:6',
      'dispose',
    ]);
    expect(result.measured).toEqual({
      tickMilliseconds: [2, 3],
      tickP50Milliseconds: 2,
      tickP95Milliseconds: 3,
      tickMaximumMilliseconds: 3,
      synchronousStepsAbove50Milliseconds: 0,
    });
    expect(result.initial.settlingTicks).toBe(5);
    expect(result.initial.settlingWallMilliseconds).toBe(55);
    expect(result.appendMutationMilliseconds).toBe(7);
    expect(result.firstPostAppendMilliseconds).toBe(6);
    expect(result.postAppend.settlingTicks).toBe(2);
    expect(result.postAppend.settlingWallMilliseconds).toBe(23);
    expect(result.initial.nonFinitePositionCount).toBe(0);
    expect(result.postAppend.nonFinitePositionCount).toBe(0);
    expect(Number.isFinite(result.postAppend.peakLinkRatio)).toBe(true);
  });

  test('fails when cooling prevents all required measured samples', async () => {
    const clock = new FakeClock();
    const layout = new FakeLayout(clock, [false], [1]);

    await expect(
      runGraphWorkload({
        graph,
        appendRootId: 'n0000',
        warmupTicks: 1,
        measuredTicks: 1,
        layout,
        now: clock.now,
        yieldTask: async () => {},
      }),
    ).rejects.toThrow('required measured samples');
    expect(layout.calls.at(-1)).toBe('dispose');
  });

  test('places appended nodes around the cooled root position', async () => {
    const clock = new FakeClock();
    const layout = new FakeLayout(clock, [false, false], []);

    await runGraphWorkload({
      graph,
      appendRootId: 'n0000',
      warmupTicks: 0,
      measuredTicks: 0,
      layout,
      now: clock.now,
      yieldTask: async () => {},
      onPhase: (phase) => {
        if (phase === 'initial-snapshot') {
          layout.positions[0] = 100;
          layout.positions[1] = 25;
        }
      },
    });

    expect(layout.appendedPayload?.nodes[0]).toEqual({
      id: 'a0000',
      type: 'work',
      radius: 5.5,
      x: 145,
      y: 25,
    });
  });

  test('rejects an active 2000th initial tick', async () => {
    const clock = new FakeClock();
    const layout = new FakeLayout(
      clock,
      Array.from({ length: 2000 }, () => true),
      [],
    );

    await expect(
      runGraphWorkload({
        graph,
        appendRootId: 'n0000',
        warmupTicks: 0,
        measuredTicks: 0,
        layout,
        now: clock.now,
        yieldTask: async () => {},
      }),
    ).rejects.toThrow('2,000-tick initial settling cap');
    expect(layout.stepIndex).toBe(2000);
    expect(layout.calls.at(-1)).toBe('dispose');
  });
});

test('creates the exact deterministic append payload', () => {
  const payload = createAppendPayload(graph, 'n0000');

  expect(payload.nodes).toHaveLength(50);
  expect(payload.nodes[0]).toEqual({
    id: 'a0000',
    type: 'work',
    radius: 5.5,
    x: 45,
    y: 0,
  });
  expect(payload.nodes[49].id).toBe('a0049');
  expect(payload.links.filter((link) => link.source === 'n0000')).toHaveLength(50);
  expect(payload.links).toContainEqual({
    id: 'a0003|related|a0004',
    source: 'a0003',
    target: 'a0004',
    predicate: 'related',
  });
  expect(payload.links).not.toContainEqual(
    expect.objectContaining({ source: 'a0000', target: 'a0001' }),
  );
});

describe('drag workload orchestration', () => {
  test('uses the specified path and repeated reheat behavior', async () => {
    const clock = new FakeClock();
    const layout = new FakeLayout(clock, [false, true, false], [1, 2, 3]);
    let yields = 0;
    const result = await runDragWorkload({
      graph,
      draggedNodeId: 'n0001',
      layout,
      now: clock.now,
      yieldTask: async () => {
        yields += 1;
        clock.advance(5);
      },
    });

    expect(yields).toBe(31);
    expect(layout.calls.filter((call) => call === 'reheat:0.25')).toHaveLength(31);
    expect(layout.calls.filter((call) => call.startsWith('pin:'))).toHaveLength(31);
    expect(layout.calls).toContain('unpin:1');
    expect(layout.calls).toContain('reheat:0.08');
    const finalDragPin = layout.calls.filter((call) => call.startsWith('pin:')).at(-1);
    expect(finalDragPin).toBe('pin:1:180:4.898587196589413e-15');
    expect(result.dragPointerError).toBeLessThanOrEqual(1);
    expect(result.postDrag.settlingTicks).toBe(2);
    expect(result.postDrag.settlingWallMilliseconds).toBe(10);
    expect(result.postDrag.nonFinitePositionCount).toBe(0);
    expect(layout.calls.at(-1)).toBe('dispose');
  });
});

test('measures the minimum positive timer delta from consecutive reads', () => {
  const samples = [0, 0, 0.5, 0.5, 0.75, 1.75];
  let index = 0;

  expect(measureTimerResolution(() => samples[index++], 5)).toBe(0.25);
  expect(index).toBe(5);
  expect(() => measureTimerResolution(() => 1, 3)).toThrow('positive timer delta');
});
