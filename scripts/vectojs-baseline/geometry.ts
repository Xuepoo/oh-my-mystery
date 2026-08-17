export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EdgeDepths {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface OverlapFinding {
  key: string;
  controlIds: [string, string];
  intersection: Rect;
  edgeDepths: EdgeDepths;
}

export interface TargetState {
  width: number;
  height: number;
  activatable: boolean;
}

export type FindingClassification =
  | 'grandfathered'
  | 'new'
  | 'worsened'
  | 'improved'
  | 'unchanged'
  | 'failed';

const GEOMETRY_TOLERANCE = 0.5;

export function intersection(left: Rect, right: Rect): Rect | null {
  assertRect(left);
  assertRect(right);
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const rightEdge = Math.min(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.min(left.y + left.height, right.y + right.height);
  if (rightEdge <= x || bottomEdge <= y) return null;
  return roundedRect({ x, y, width: rightEdge - x, height: bottomEdge - y });
}

export function overlapFinding(
  scenarioId: string,
  firstId: string,
  first: Rect,
  secondId: string,
  second: Rect,
): OverlapFinding | null {
  const overlap = intersection(first, second);
  if (!overlap || overlap.width <= GEOMETRY_TOLERANCE || overlap.height <= GEOMETRY_TOLERANCE) {
    return null;
  }
  const controlIds = [firstId, secondId].sort() as [string, string];
  return {
    key: `${scenarioId}:${controlIds[0]}|${controlIds[1]}`,
    controlIds,
    intersection: overlap,
    edgeDepths: {
      left: overlap.width,
      right: overlap.width,
      top: overlap.height,
      bottom: overlap.height,
    },
  };
}

export function escapeDepths(rect: Rect, viewport: Rect): EdgeDepths {
  assertRect(rect);
  assertRect(viewport);
  return {
    left: round(Math.max(0, viewport.x - rect.x)),
    right: round(Math.max(0, rect.x + rect.width - (viewport.x + viewport.width))),
    top: round(Math.max(0, viewport.y - rect.y)),
    bottom: round(Math.max(0, rect.y + rect.height - (viewport.y + viewport.height))),
  };
}

export function classifyTargetFinding(
  baseline: TargetState | undefined,
  candidate: TargetState | undefined,
): FindingClassification {
  if (!candidate) return baseline ? 'failed' : 'unchanged';
  if (baseline?.activatable && !candidate.activatable) return 'failed';
  const candidateUndersized = candidate.width < 44 || candidate.height < 44;
  if (!baseline) return candidateUndersized ? 'new' : 'unchanged';
  if (
    candidate.width < baseline.width - GEOMETRY_TOLERANCE ||
    candidate.height < baseline.height - GEOMETRY_TOLERANCE
  ) {
    return 'worsened';
  }
  const baselineUndersized = baseline.width < 44 || baseline.height < 44;
  if (baselineUndersized && !candidateUndersized) return 'improved';
  if (baselineUndersized) return 'grandfathered';
  return candidateUndersized ? 'new' : 'unchanged';
}

export function classifyOverlapFinding(
  baseline: EdgeDepths | undefined,
  candidate: EdgeDepths | undefined,
): FindingClassification {
  return classifyEdgeFinding(baseline, candidate, 1);
}

export function classifyEscapeFinding(
  baseline: EdgeDepths | undefined,
  candidate: EdgeDepths | undefined,
): FindingClassification {
  return classifyEdgeFinding(baseline, candidate, GEOMETRY_TOLERANCE);
}

function classifyEdgeFinding(
  baseline: EdgeDepths | undefined,
  candidate: EdgeDepths | undefined,
  worseningTolerance: number,
): FindingClassification {
  if (!baseline) return candidate ? 'new' : 'unchanged';
  if (!candidate) return 'improved';
  const edges: Array<keyof EdgeDepths> = ['left', 'right', 'top', 'bottom'];
  if (edges.some((edge) => candidate[edge] > baseline[edge] + worseningTolerance)) {
    return 'worsened';
  }
  if (edges.some((edge) => candidate[edge] < baseline[edge] - GEOMETRY_TOLERANCE)) {
    return 'improved';
  }
  return 'grandfathered';
}

function roundedRect(rect: Rect): Rect {
  return {
    x: round(rect.x),
    y: round(rect.y),
    width: round(rect.width),
    height: round(rect.height),
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function assertRect(rect: Rect): void {
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width < 0 ||
    rect.height < 0
  ) {
    throw new TypeError('Rectangle coordinates must be finite with non-negative dimensions');
  }
}
