import type { Page } from 'playwright';

export type ScenarioMode = 'desktop' | 'mobile';
export type ScenarioId =
  | 'desktop-bootstrap'
  | 'desktop-search'
  | 'desktop-graph-input'
  | 'desktop-casefile'
  | 'desktop-tools'
  | 'desktop-idle'
  | 'mobile-bootstrap'
  | 'mobile-header'
  | 'mobile-graph-input'
  | 'mobile-casefile'
  | 'mobile-tools'
  | 'mobile-idle';

const scenarios: Record<ScenarioId, readonly string[]> = {
  'desktop-bootstrap': ['navigate', 'assert-root', 'assert-finite-camera-geometry'],
  'desktop-search': [
    'navigate',
    'press-search-shortcut',
    'type-search',
    'activate-first-result',
    'assert-one-selection',
    'record-camera',
  ],
  'desktop-graph-input': [
    'navigate',
    'click-root',
    'double-click-root',
    'drag-related-work',
    'wheel-zoom',
    'pan-blank',
    'activate-fit',
    'assert-no-pointer-owner',
  ],
  'desktop-casefile': [
    'navigate',
    'open-root',
    'await-profile',
    'activate-relations',
    'activate-recommendations',
    'load-relation-page',
    'copy-first-field',
    'scroll-casefile',
    'follow-related-author',
    'close-casefile',
    'assert-fixture-requests-and-copy',
  ],
  'desktop-tools': [
    'navigate',
    'toggle-relationship-filters',
    'open-close-stats',
    'open-close-minimap',
    'clear-graph',
    'undo-clear',
    'open-close-visibility',
    'activate-fit',
    'freeze-then-resume',
    'reset-camera',
  ],
  'desktop-idle': ['navigate', 'await-idle', 'observe-120-frames'],
  'mobile-bootstrap': [
    'navigate',
    'assert-root',
    'assert-dpr-backing',
    'assert-finite-camera-geometry',
  ],
  'mobile-header': [
    'navigate',
    'press-search-shortcut',
    'type-search',
    'escape-search',
    'record-header-geometry',
  ],
  'mobile-graph-input': [
    'navigate',
    'tap-root',
    'double-tap-root',
    'long-press-root',
    'pan-blank',
    'drag-related-work',
    'pinch-80-to-120',
    'cancel-pending-pointer',
    'assert-no-pointer-owner',
  ],
  'mobile-casefile': [
    'navigate',
    'open-root',
    'copy-first-field',
    'scroll-from-copy-field-without-copy',
    'activate-relations',
    'follow-related-author',
    'close-casefile',
    'assert-fixture-requests-and-copy',
  ],
  'mobile-tools': [
    'navigate',
    'toggle-rendered-relationship-filters',
    'open-close-rendered-stats',
    'open-close-rendered-minimap',
    'clear-rendered-graph',
    'undo-rendered-clear',
    'open-close-rendered-visibility',
    'activate-rendered-fit',
    'freeze-then-resume-rendered',
    'reset-rendered-camera',
    'record-target-overlap-escape-transitions',
  ],
  'mobile-idle': ['navigate', 'await-idle', 'observe-120-frames'],
};

const desktopIds = Object.keys(scenarios).filter((id) => id.startsWith('desktop-')) as ScenarioId[];
const mobileIds = Object.keys(scenarios).filter((id) => id.startsWith('mobile-')) as ScenarioId[];

export function scenarioIds(mode: ScenarioMode): readonly ScenarioId[] {
  return [...(mode === 'desktop' ? desktopIds : mobileIds)];
}

export function scenarioSteps(scenarioId: ScenarioId): readonly string[] {
  return [...scenarios[scenarioId]];
}

export interface InteractionInstrumentation {
  ready?: boolean;
  animationFree?: boolean;
  camera?: { panX: number; panY: number; zoom: number };
  graph?: { nodeCount: number; linkCount: number; hiddenNodeCount: number };
  pointerOwnership?: unknown;
  drawer?: unknown;
  tools?: unknown;
}

export interface InteractionResultRecord {
  runId: string;
  scenarioId: ScenarioId;
  sequence: number;
  stepId: string;
  instrumentation: InteractionInstrumentation;
}

interface InteractionPage {
  evaluate(pageFunction: unknown): Promise<unknown>;
}

export async function readInteractionInstrumentation(
  page: Page | InteractionPage,
): Promise<InteractionInstrumentation> {
  return page.evaluate(() => {
    const value = (
      window as unknown as { __OMM_APP__?: { instrumentation?: InteractionInstrumentation } }
    ).__OMM_APP__?.instrumentation;
    if (!value) throw new Error('OMM instrumentation is unavailable');
    return {
      ready: value.ready,
      animationFree: value.animationFree,
      camera: value.camera,
      graph: value.graph,
      pointerOwnership: value.pointerOwnership,
      drawer: value.drawer,
      tools: value.tools,
    };
  }) as Promise<InteractionInstrumentation>;
}

export async function runScenario(
  scenarioId: ScenarioId,
  page: Page | InteractionPage,
  options: {
    runId: string;
    execute: (stepId: string, page: Page | InteractionPage) => Promise<void>;
  },
): Promise<InteractionResultRecord[]> {
  const records: InteractionResultRecord[] = [];
  for (const [sequence, stepId] of scenarios[scenarioId].entries()) {
    try {
      await options.execute(stepId, page);
      records.push({
        runId: options.runId,
        scenarioId,
        sequence,
        stepId,
        instrumentation: await readInteractionInstrumentation(page),
      });
    } catch (error) {
      throw new Error(
        `${scenarioId}/${stepId}: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error,
        },
      );
    }
  }
  return records;
}
