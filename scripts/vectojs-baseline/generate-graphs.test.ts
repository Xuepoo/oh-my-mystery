import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  generateGraph,
  graphFixtureDirectory,
  graphSpecs,
  serializeGraph,
} from './generate-graphs';

describe('deterministic graph fixtures', () => {
  test.each([
    ['sparse-500', 500, 598],
    ['hub-1000', 1000, 1123],
    ['mixed-3000', 3000, 6260],
  ] as const)(
    '%s has the approved topology and exact committed bytes',
    async (id, nodes, links) => {
      const graph = generateGraph(graphSpecs[id]);
      const bytes = serializeGraph(graph);
      const committed = await readFile(join(graphFixtureDirectory, `${id}.json`), 'utf8');

      expect(graph.nodes).toHaveLength(nodes);
      expect(graph.links).toHaveLength(links);
      expect(new Set(graph.links.map((link) => link.id)).size).toBe(links);
      expect(graph.nodes.map((node) => node.id)).toEqual(
        [...graph.nodes.map((node) => node.id)].sort(),
      );
      expect(graph.links.map((link) => link.id)).toEqual(
        [...graph.links.map((link) => link.id)].sort(),
      );
      expect(bytes.endsWith('\n')).toBe(true);
      expect(bytes.endsWith('\n\n')).toBe(false);
      expect(committed).toBe(bytes);
    },
  );

  test('preserves the required JSON property order', () => {
    const serialized = serializeGraph(generateGraph(graphSpecs['sparse-500']));

    expect(serialized.indexOf('"nodes"')).toBeLessThan(serialized.indexOf('"links"'));
    expect(serialized).toContain(
      '"id": "n0000",\n      "type": "author",\n      "radius": 9,\n      "x": 35,\n      "y": 0',
    );
    expect(serialized).toContain(
      '"id": "n0000|related|n0001",\n      "source": "n0000",\n      "target": "n0001",\n      "predicate": "related"',
    );
  });
});
