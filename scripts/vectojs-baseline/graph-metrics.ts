export interface Position {
  id: string;
  x: number;
  y: number;
}

export interface CollisionPosition extends Position {
  radius: number;
}

export interface MetricLink {
  source: string;
  target: string;
}

export function nonFinitePositionCount(positions: readonly Position[]): number {
  return positions.reduce(
    (count, position) =>
      count + Number(!Number.isFinite(position.x) || !Number.isFinite(position.y)),
    0,
  );
}

export function collisionOverlapCount(
  positions: readonly CollisionPosition[],
  tolerance = 1,
): number {
  let count = 0;
  for (let left = 0; left < positions.length; left += 1) {
    for (let right = left + 1; right < positions.length; right += 1) {
      const a = positions[left];
      const b = positions[right];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (a.radius + b.radius - distance > tolerance) count += 1;
    }
  }
  return count;
}

export function undirectedHopDistances(
  links: readonly MetricLink[],
  rootId: string,
): Map<string, number> {
  const adjacency = new Map<string, string[]>();
  for (const link of links) {
    adjacency.set(link.source, [...(adjacency.get(link.source) ?? []), link.target]);
    adjacency.set(link.target, [...(adjacency.get(link.target) ?? []), link.source]);
  }

  const distances = new Map<string, number>([[rootId, 0]]);
  const queue = [rootId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];
    const nextDistance = distances.get(id)! + 1;
    for (const neighbor of adjacency.get(id) ?? []) {
      if (distances.has(neighbor)) continue;
      distances.set(neighbor, nextDistance);
      queue.push(neighbor);
    }
  }
  return distances;
}

export function displacementMetrics(
  before: readonly Position[],
  after: readonly Position[],
  hops: ReadonlyMap<string, number>,
  farHopThreshold = 2,
): { rms: number; farMaximum: number } {
  const afterById = new Map(after.map((position) => [position.id, position]));
  let squaredTotal = 0;
  let count = 0;
  let farMaximum = 0;
  for (const initial of before) {
    const final = afterById.get(initial.id);
    if (!final) throw new Error(`Missing final position for ${initial.id}`);
    const displacement = Math.hypot(final.x - initial.x, final.y - initial.y);
    if (!Number.isFinite(displacement))
      throw new Error(`Non-finite displacement for ${initial.id}`);
    squaredTotal += displacement * displacement;
    count += 1;
    if ((hops.get(initial.id) ?? Number.POSITIVE_INFINITY) > farHopThreshold) {
      farMaximum = Math.max(farMaximum, displacement);
    }
  }
  return { rms: count === 0 ? 0 : Math.sqrt(squaredTotal / count), farMaximum };
}

export function peakLinkLengthRatio(
  positions: readonly Position[],
  links: readonly MetricLink[],
  restLength: (link: MetricLink) => number,
): number {
  const byId = new Map(positions.map((position) => [position.id, position]));
  let peak = 0;
  for (const link of links) {
    const source = byId.get(link.source);
    const target = byId.get(link.target);
    if (!source || !target)
      throw new Error(`Missing endpoint for ${link.source} -> ${link.target}`);
    const configuredLength = restLength(link);
    const ratio = Math.hypot(target.x - source.x, target.y - source.y) / configuredLength;
    if (!Number.isFinite(ratio) || configuredLength <= 0) {
      throw new Error(`Invalid link ratio for ${link.source} -> ${link.target}`);
    }
    peak = Math.max(peak, ratio);
  }
  return peak;
}

export function velocityDirectionChangeCount(
  snapshots: readonly (readonly Position[])[],
  excludedNodeId?: string,
  speedThreshold = 0.01,
): number {
  if (snapshots.length < 3) return 0;
  const deltas = snapshots.slice(1).map((snapshot, index) => {
    const previous = new Map(snapshots[index].map((position) => [position.id, position]));
    return snapshot.map((position) => {
      const old = previous.get(position.id);
      if (!old) throw new Error(`Missing previous position for ${position.id}`);
      return { id: position.id, x: position.x - old.x, y: position.y - old.y };
    });
  });
  const lateDeltas = deltas.slice(-60);
  let changes = 0;
  for (let index = 1; index < lateDeltas.length; index += 1) {
    const previous = new Map(lateDeltas[index - 1].map((velocity) => [velocity.id, velocity]));
    for (const velocity of lateDeltas[index]) {
      if (velocity.id === excludedNodeId) continue;
      const old = previous.get(velocity.id);
      if (!old) throw new Error(`Missing previous velocity for ${velocity.id}`);
      if (
        Math.hypot(old.x, old.y) <= speedThreshold ||
        Math.hypot(velocity.x, velocity.y) <= speedThreshold
      ) {
        continue;
      }
      if (old.x !== 0 && velocity.x !== 0 && Math.sign(old.x) !== Math.sign(velocity.x))
        changes += 1;
      if (old.y !== 0 && velocity.y !== 0 && Math.sign(old.y) !== Math.sign(velocity.y))
        changes += 1;
    }
  }
  return changes;
}
