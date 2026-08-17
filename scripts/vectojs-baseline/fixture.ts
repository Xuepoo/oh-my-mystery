import { readFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface FixtureRoute {
  id: string;
  method: 'GET';
  url: string;
  status: number;
  delayMs: number;
  response: string;
}

export interface FixtureManifest {
  schemaVersion: 1;
  entities: {
    rootAuthor: 'wd:Q347412';
    relatedWork: 'wd:Q1001';
    relatedAuthor: 'wd:Q35064';
    hiddenWork: 'wd:Q1002';
    globalOnlyResult: 'wd:Q9999';
  };
  expected: { firstProfileCopy: '江户川乱步' };
  controls: string[];
  allowedContainmentPairs: [string, string][];
  routes: FixtureRoute[];
}

export const fixtureDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'vectojs-baseline',
);

const requiredControls = [
  'header.search',
  'header.pathfinder',
  'header.settings',
  'header.chronicle',
  'header.help',
  'tool.relationship',
  'tool.stats',
  'tool.minimap',
  'tool.clear',
  'tool.history.undo',
  'tool.history.redo',
  'tool.visibility',
  'viewport.fit',
  'viewport.freeze',
  'viewport.reset',
  'casefile.close',
  'casefile.copy',
  'casefile.tab.profile',
  'casefile.tab.relations',
  'casefile.tab.recommendations',
];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function loadAndValidateFixture(): Promise<{
  manifest: FixtureManifest;
  responses: Map<string, Uint8Array>;
}> {
  const manifestBytes = await readFile(join(fixtureDirectory, 'manifest.json'), 'utf8');
  assert(
    manifestBytes.endsWith('\n') && !manifestBytes.endsWith('\n\n'),
    'Manifest must have one final newline',
  );
  const manifest = JSON.parse(manifestBytes) as FixtureManifest;
  assert(manifest.schemaVersion === 1, 'Unsupported fixture schema version');
  assert(manifest.entities.rootAuthor === 'wd:Q347412', 'Invalid root author ID');
  assert(manifest.entities.relatedWork === 'wd:Q1001', 'Invalid related work ID');
  assert(manifest.entities.relatedAuthor === 'wd:Q35064', 'Invalid related author ID');
  assert(manifest.entities.hiddenWork === 'wd:Q1002', 'Invalid hidden work ID');
  assert(manifest.entities.globalOnlyResult === 'wd:Q9999', 'Invalid global result ID');
  assert(manifest.expected.firstProfileCopy === '江户川乱步', 'Invalid first profile copy value');
  assert(
    manifest.routes.length >= 18 && manifest.routes.length <= 30,
    'Fixture route count is not bounded',
  );
  assert(new Set(manifest.controls).size === manifest.controls.length, 'Duplicate control ID');
  for (const control of requiredControls)
    assert(manifest.controls.includes(control), `Missing control ${control}`);

  const routeKeys = new Set<string>();
  const responses = new Map<string, Uint8Array>();
  let responseText = '';
  for (const route of manifest.routes) {
    const key = `${route.method} ${route.url}`;
    assert(!routeKeys.has(key), `Duplicate fixture route ${key}`);
    routeKeys.add(key);
    assert(route.url.startsWith('/api/'), `Invalid fixture URL ${route.url}`);
    assert(
      Number.isInteger(route.delayMs) && route.delayMs >= 0 && route.delayMs <= 1000,
      `Invalid delay for ${route.id}`,
    );
    assert(
      Number.isInteger(route.status) && route.status >= 200 && route.status <= 599,
      `Invalid status for ${route.id}`,
    );
    const relative = normalize(route.response);
    assert(
      relative.startsWith(`responses${sep}`) && !relative.includes(`..${sep}`),
      `Invalid response path ${route.response}`,
    );
    const bytes = await readFile(join(fixtureDirectory, relative));
    const text = bytes.toString('utf8');
    assert(
      text.endsWith('\n') && !text.endsWith('\n\n'),
      `Invalid final newline in ${route.response}`,
    );
    JSON.parse(text);
    responseText += text;
    responses.set(route.id, bytes);
  }
  assert(responses.size === manifest.routes.length, 'Duplicate fixture route ID');
  for (const id of Object.values(manifest.entities)) {
    assert(responseText.includes(id), `Fixture responses do not contain ${id}`);
  }
  assert(
    responseText.includes(manifest.expected.firstProfileCopy),
    'Fixture responses do not contain the expected copied value',
  );
  return { manifest, responses };
}
