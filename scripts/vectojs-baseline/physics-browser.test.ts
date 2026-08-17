import { expect, test } from 'bun:test';
import {
  createProductionLayoutOptions,
  runPhysicsBrowserWorkload,
  type ForceLayoutConstructor,
} from './physics-browser';
import type { PhysicsGraph, PhysicsLayout } from './physics';

const graph: PhysicsGraph = {
  nodes: [
    { id: 'n0000', type: 'author', radius: 9, x: 0, y: 0 },
    { id: 'n0001', type: 'work', radius: 5.5, x: 10, y: 0 },
    { id: 'n0002', type: 'character', radius: 6.5, x: 20, y: 0 },
  ],
  links: [],
};

test('freezes the production balanced-layout options', () => {
  const options = createProductionLayoutOptions(graph);

  expect(options.repulsion(graph.nodes[0], 0)).toBe(194);
  expect(options.collisionRadius(graph.nodes[1], 1)).toBe(19.5);
  expect(options.repulsion({ ...graph.nodes[0], radius: 100 }, 0)).toBe(194);
  expect(options.linkDistance({ source: 'n0000', target: 'n0001' }, 0)).toBe(48.85);
  expect(options.linkDistance({ source: 'n0000', target: 'n0002' }, 0)).toBe(55.7);
  expect(options.linkStrength).toBe(0.42);
  expect(options.collisionStrength).toBe(0.7);
  expect(options.centerStrength).toBe(0.016);
  expect(options.velocityDecay).toBe(0.64);
  expect(options.alphaDecay).toBe(0.024);
  expect(options.repulsionDistanceMax).toBe(450);
  expect(options.seed).toBe(7);
});

test('constructs an injected layout and returns timer resolution with the workload result', async () => {
  let receivedOptions: ReturnType<typeof createProductionLayoutOptions> | undefined;
  let appendedLinkDistance: number | undefined;
  class FakeForceLayout implements PhysicsLayout {
    positions = new Float32Array(graph.nodes.flatMap((node) => [node.x, node.y]));
    nodeCount = graph.nodes.length;
    ids = graph.nodes.map((node) => node.id);

    constructor(options: ReturnType<typeof createProductionLayoutOptions>) {
      receivedOptions = options;
    }

    setGraph(): void {}
    appendGraph(payload: PhysicsGraph): void {
      const appendedChainLink = payload.links.find((link) => link.source.startsWith('a'))!;
      appendedLinkDistance = receivedOptions!.linkDistance(appendedChainLink, 0);
      this.ids.push(...payload.nodes.map((node) => node.id));
      this.nodeCount = this.ids.length;
      this.positions = new Float32Array([
        ...this.positions,
        ...payload.nodes.flatMap((node) => [node.x, node.y]),
      ]);
    }
    step(): boolean {
      return false;
    }
    getNodeIndex(id: string): number | undefined {
      return this.ids.indexOf(id);
    }
    getNodeIds(): readonly string[] {
      return this.ids;
    }
    pinNode(): void {}
    unpinNode(): void {}
    reheat(): void {}
    dispose(): void {}
  }

  const times = [0, 0.5, 1, 2, 3, 4, 5, 6, 7];
  let timeIndex = 0;
  const result = await runPhysicsBrowserWorkload(
    FakeForceLayout as ForceLayoutConstructor,
    {
      kind: 'graph',
      graph,
      appendRootId: 'n0000',
      warmupTicks: 0,
      measuredTicks: 0,
    },
    {
      timerReads: 2,
      now: () => times[timeIndex++] ?? times.at(-1)!,
      yieldTask: async () => {},
    },
  );

  expect(receivedOptions?.seed).toBe(7);
  expect(appendedLinkDistance).toBe(56.5);
  expect(result.timerResolutionMilliseconds).toBe(0.5);
  expect(result.kind).toBe('graph');
});
