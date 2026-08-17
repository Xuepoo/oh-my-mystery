import {
  escapeDepths,
  overlapFinding,
  type EdgeDepths,
  type OverlapFinding,
  type Rect,
} from './geometry';
import type { Page } from 'playwright';

export interface InstrumentedAuditTarget {
  id: string;
  rect: { x: number; y: number; w: number; h: number };
  activatable: boolean;
  hitOwnerId: string | null;
}

export interface TargetAuditFinding {
  runId: string;
  key: string;
  controlId: string;
  rect: Rect;
  width: number;
  height: number;
  activatable: boolean;
  hitOwnerId: string | null;
}

export interface EscapeAuditFinding {
  runId: string;
  key: string;
  controlId: string;
  edgeDepths: EdgeDepths;
}

export interface GeometryAuditResult {
  targets: TargetAuditFinding[];
  overlaps: Array<OverlapFinding & { runId: string }>;
  escapes: EscapeAuditFinding[];
}

interface AuditPage {
  evaluate(pageFunction: unknown): Promise<unknown>;
}

export async function collectGeometryFromPage(
  page: Page | AuditPage,
  input: Omit<Parameters<typeof collectGeometryAudit>[0], 'targets'>,
): Promise<GeometryAuditResult> {
  const targets = (await page.evaluate(() => {
    const instrumentation = (
      window as unknown as {
        __OMM_APP__?: {
          instrumentation?: {
            targets: readonly {
              id: string;
              rect: { x: number; y: number; w: number; h: number };
            }[];
            hitTest(x: number, y: number): { overUI: boolean; nodeId: string | null };
          };
        };
      }
    ).__OMM_APP__?.instrumentation;
    if (!instrumentation) throw new Error('OMM instrumentation is unavailable');
    return instrumentation.targets.map((target) => {
      const x = target.rect.x + target.rect.w / 2;
      const y = target.rect.y + target.rect.h / 2;
      const hit = instrumentation.hitTest(x, y);
      return {
        ...target,
        activatable: hit.overUI,
        hitOwnerId: hit.overUI ? target.id : hit.nodeId,
      };
    });
  })) as InstrumentedAuditTarget[];
  const expected = new Set(input.controls);
  return collectGeometryAudit({ ...input, targets: targets.filter(({ id }) => expected.has(id)) });
}

export function collectGeometryAudit(input: {
  runId: string;
  scenarioId: string;
  viewport: Rect;
  controls: readonly string[];
  allowedContainmentPairs: readonly [string, string][];
  targets: readonly InstrumentedAuditTarget[];
}): GeometryAuditResult {
  const expected = new Set(input.controls);
  const byId = new Map<string, InstrumentedAuditTarget>();
  for (const target of input.targets) {
    if (!expected.has(target.id)) throw new Error(`Unknown rendered target ${target.id}`);
    if (byId.has(target.id)) throw new Error(`Duplicate rendered target ${target.id}`);
    byId.set(target.id, target);
  }
  for (const id of input.controls)
    if (!byId.has(id)) throw new Error(`Missing rendered target ${id}`);

  const targets = input.controls.map((id) => {
    const target = byId.get(id)!;
    const rect = roundRect({
      x: target.rect.x,
      y: target.rect.y,
      width: target.rect.w,
      height: target.rect.h,
    });
    return {
      runId: input.runId,
      key: `${input.scenarioId}:${id}`,
      controlId: id,
      rect,
      width: rect.width,
      height: rect.height,
      activatable: target.activatable,
      hitOwnerId: target.hitOwnerId,
    };
  });
  const allowed = new Set(
    input.allowedContainmentPairs.map(([left, right]) => pairKey(left, right)),
  );
  const overlaps: Array<OverlapFinding & { runId: string }> = [];
  for (let left = 0; left < targets.length; left += 1) {
    for (let right = left + 1; right < targets.length; right += 1) {
      if (allowed.has(pairKey(targets[left].controlId, targets[right].controlId))) continue;
      const finding = overlapFinding(
        input.scenarioId,
        targets[left].controlId,
        targets[left].rect,
        targets[right].controlId,
        targets[right].rect,
      );
      if (finding) overlaps.push({ runId: input.runId, ...finding });
    }
  }
  const escapes = targets.flatMap((target) => {
    const edgeDepths = escapeDepths(target.rect, input.viewport);
    return Object.values(edgeDepths).some((depth) => depth > 0)
      ? [{ runId: input.runId, key: target.key, controlId: target.controlId, edgeDepths }]
      : [];
  });
  return { targets, overlaps, escapes };
}

export interface IdleAuditRecord {
  runId: string;
  scenarioId: string;
  frameCount: number;
  dirtyFrameCount: number;
  everyFrameDirtyCauses: string[];
  passed: boolean;
}

export function collectIdleAudit(
  runId: string,
  scenarioId: string,
  frameDirtyCauses: readonly (readonly string[])[],
): IdleAuditRecord {
  if (frameDirtyCauses.length !== 120)
    throw new Error(`Idle audit requires 120 frames, received ${frameDirtyCauses.length}`);
  const allCauses = new Set(frameDirtyCauses.flat());
  const everyFrameDirtyCauses = [...allCauses]
    .filter((cause) => frameDirtyCauses.every((frame) => frame.includes(cause)))
    .sort();
  if (everyFrameDirtyCauses.length > 0)
    throw new Error(
      `Idle audit failed: every-frame dirty cause ${everyFrameDirtyCauses.join(', ')}`,
    );
  return {
    runId,
    scenarioId,
    frameCount: frameDirtyCauses.length,
    dirtyFrameCount: frameDirtyCauses.filter((frame) => frame.length > 0).length,
    everyFrameDirtyCauses,
    passed: true,
  };
}

function pairKey(left: string, right: string): string {
  return [left, right].sort().join('|');
}

function roundRect(rect: Rect): Rect {
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    x: round(rect.x),
    y: round(rect.y),
    width: round(rect.width),
    height: round(rect.height),
  };
}
