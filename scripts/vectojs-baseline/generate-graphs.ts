import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const nodeTypes = ['author', 'work', 'publisher', 'award', 'character', 'series'] as const;
const radii = [9, 5.5, 5, 7.5, 6.5, 5] as const;

export interface GraphNodeFixture {
  id: string;
  type: (typeof nodeTypes)[number];
  radius: number;
  x: number;
  y: number;
}

export interface GraphLinkFixture {
  id: string;
  source: string;
  target: string;
  predicate: 'related';
}

export interface GraphFixture {
  nodes: GraphNodeFixture[];
  links: GraphLinkFixture[];
}

interface GraphSpec {
  id: 'sparse-500' | 'hub-1000' | 'mixed-3000';
  nodeCount: number;
}

export const graphSpecs: Record<GraphSpec['id'], GraphSpec> = {
  'sparse-500': { id: 'sparse-500', nodeCount: 500 },
  'hub-1000': { id: 'hub-1000', nodeCount: 1000 },
  'mixed-3000': { id: 'mixed-3000', nodeCount: 3000 },
};

export const graphFixtureDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'vectojs-baseline',
  'graphs',
);

function nodeId(index: number): string {
  return `n${String(index).padStart(4, '0')}`;
}

function makeNode(index: number): GraphNodeFixture {
  const typeIndex = index % nodeTypes.length;
  const angle = index * 2.399963229728653;
  const distance = 35 + Math.sqrt(index) * 18;
  return {
    id: nodeId(index),
    type: nodeTypes[typeIndex],
    radius: radii[typeIndex],
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance,
  };
}

function addLink(
  links: GraphLinkFixture[],
  ids: Set<string>,
  sourceIndex: number,
  targetIndex: number,
): void {
  const source = nodeId(sourceIndex);
  const target = nodeId(targetIndex);
  const id = `${source}|related|${target}`;
  if (ids.has(id)) throw new Error(`Duplicate graph link: ${id}`);
  ids.add(id);
  links.push({ id, source, target, predicate: 'related' });
}

export function generateGraph(spec: GraphSpec): GraphFixture {
  const nodes = Array.from({ length: spec.nodeCount }, (_, index) => makeNode(index));
  const links: GraphLinkFixture[] = [];
  const linkIds = new Set<string>();

  if (spec.id === 'sparse-500') {
    for (let index = 1; index < spec.nodeCount; index += 1) {
      addLink(links, linkIds, index - 1, index);
      if (index % 5 === 0) addLink(links, linkIds, index - 5, index);
    }
  } else if (spec.id === 'hub-1000') {
    for (let index = 1; index < spec.nodeCount; index += 1) {
      addLink(links, linkIds, 0, index);
      if (index % 8 === 0) addLink(links, linkIds, index - 1, index);
    }
  } else {
    for (let index = 0; index < spec.nodeCount; index += 1) {
      const hub = Math.floor(index / 1000) * 1000;
      if (index === hub) continue;
      addLink(links, linkIds, hub, index);
      if (index - 1 !== hub) addLink(links, linkIds, index - 1, index);
      if (index % 11 === 0 && index - 11 >= hub) {
        const diagonalId = `${nodeId(index - 11)}|related|${nodeId(index)}`;
        if (!linkIds.has(diagonalId)) addLink(links, linkIds, index - 11, index);
      }
    }
  }

  nodes.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  links.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return { nodes, links };
}

export function serializeGraph(graph: GraphFixture): string {
  return `${JSON.stringify(graph, null, 2)}\n`;
}

export async function generateGraphFixtures(check: boolean): Promise<void> {
  if (!check) await mkdir(graphFixtureDirectory, { recursive: true });

  const mismatches: string[] = [];
  for (const spec of Object.values(graphSpecs)) {
    const path = join(graphFixtureDirectory, `${spec.id}.json`);
    const expected = serializeGraph(generateGraph(spec));
    if (check) {
      const actual = await readFile(path, 'utf8').catch(() => undefined);
      if (actual !== expected) mismatches.push(spec.id);
    } else {
      await writeFile(path, expected, 'utf8');
    }
  }

  if (mismatches.length > 0) {
    throw new Error(`Graph fixtures are missing or stale: ${mismatches.join(', ')}`);
  }
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  if (args.some((arg) => arg !== '--check') || args.filter((arg) => arg === '--check').length > 1) {
    console.error('Usage: bun run scripts/vectojs-baseline/generate-graphs.ts [--check]');
    process.exitCode = 2;
  } else {
    await generateGraphFixtures(args.includes('--check')).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
