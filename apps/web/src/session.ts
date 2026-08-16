import type { KnowledgeGraphSnapshot } from './scene/KnowledgeGraph2D';

export const SESSION_VERSION = 1;
export const SESSION_KEY = 'omm-graph-session-v1';

export interface GraphSessionSnapshot {
  version: 1;
  camera: { panX: number; panY: number; zoom: number };
  graph: KnowledgeGraphSnapshot;
  expansionHistory: string[];
  filter: string | null;
  relationshipIndexes: number[];
  endpoints: {
    source: { id: string; name: string } | null;
    target: { id: string; name: string } | null;
    status: 'idle' | 'source' | 'success' | 'noPath' | 'failure';
  };
}

export function loadSession(): GraphSessionSnapshot | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as GraphSessionSnapshot;
    return value?.version === SESSION_VERSION && value.graph ? value : null;
  } catch {
    return null;
  }
}

export function saveSession(snapshot: GraphSessionSnapshot): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(snapshot));
  } catch {
    // Persistence is best effort.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore unavailable storage.
  }
}
