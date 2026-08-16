import { Theme } from './ui/theme';

export const NODE_STYLE_SETTINGS_VERSION = 1;
export const NODE_STYLE_SETTINGS_STORAGE_KEY = 'omm-node-style-settings-v1';

export const NODE_TYPES = [
  'author',
  'work',
  'award',
  'character',
  'series',
  'publisher',
  'genre',
  'other',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];
export type DistributionMode = 'compact' | 'balanced' | 'dispersed';

export interface NodeStyleSettings {
  version: typeof NODE_STYLE_SETTINGS_VERSION;
  colors: Record<NodeType, string>;
  sizeMultipliers: Record<NodeType, number>;
  distribution: DistributionMode;
}

const MIN_SIZE_MULTIPLIER = 0.5;
const MAX_SIZE_MULTIPLIER = 2;
const DISTRIBUTION_MODES: DistributionMode[] = ['compact', 'balanced', 'dispersed'];

function defaultColors(): Record<NodeType, string> {
  return Object.fromEntries(NODE_TYPES.map((type) => [type, Theme.colors[type]])) as Record<
    NodeType,
    string
  >;
}

function defaultSizeMultipliers(): Record<NodeType, number> {
  return Object.fromEntries(NODE_TYPES.map((type) => [type, 1])) as Record<NodeType, number>;
}

export function createDefaultNodeStyleSettings(): NodeStyleSettings {
  return {
    version: NODE_STYLE_SETTINGS_VERSION,
    colors: defaultColors(),
    sizeMultipliers: defaultSizeMultipliers(),
    distribution: 'balanced',
  };
}

export function normalizeNodeType(type: unknown): NodeType {
  if (type === 'person') return 'author';
  return NODE_TYPES.includes(type as NodeType) ? (type as NodeType) : 'other';
}

function clampSizeMultiplier(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(MIN_SIZE_MULTIPLIER, Math.min(MAX_SIZE_MULTIPLIER, value));
}

function isColor(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSettings(value: unknown): NodeStyleSettings {
  const defaults = createDefaultNodeStyleSettings();
  if (!isRecord(value)) return defaults;

  const colors = { ...defaults.colors };
  if (isRecord(value.colors)) {
    for (const type of NODE_TYPES) {
      if (isColor(value.colors[type])) colors[type] = value.colors[type];
    }
  }

  const sizeMultipliers = { ...defaults.sizeMultipliers };
  if (isRecord(value.sizeMultipliers)) {
    for (const type of NODE_TYPES) {
      sizeMultipliers[type] = clampSizeMultiplier(
        value.sizeMultipliers[type],
        defaults.sizeMultipliers[type],
      );
    }
  }

  return {
    version: NODE_STYLE_SETTINGS_VERSION,
    colors,
    sizeMultipliers,
    distribution: DISTRIBUTION_MODES.includes(value.distribution as DistributionMode)
      ? (value.distribution as DistributionMode)
      : defaults.distribution,
  };
}

function getStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function loadNodeStyleSettings(): NodeStyleSettings {
  try {
    const raw = getStorage()?.getItem(NODE_STYLE_SETTINGS_STORAGE_KEY);
    if (!raw) return createDefaultNodeStyleSettings();
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== NODE_STYLE_SETTINGS_VERSION) {
      return createDefaultNodeStyleSettings();
    }
    return normalizeSettings(parsed);
  } catch {
    return createDefaultNodeStyleSettings();
  }
}

export function saveNodeStyleSettings(settings: NodeStyleSettings): void {
  try {
    getStorage()?.setItem(
      NODE_STYLE_SETTINGS_STORAGE_KEY,
      JSON.stringify(normalizeSettings(settings)),
    );
  } catch {
    // Storage can be unavailable or quota-limited; callers still retain in-memory settings.
  }
}

export function resetNodeStyleSettings(): NodeStyleSettings {
  const defaults = createDefaultNodeStyleSettings();
  try {
    getStorage()?.removeItem(NODE_STYLE_SETTINGS_STORAGE_KEY);
  } catch {
    // Ignore unavailable storage during reset.
  }
  return defaults;
}

export class NodeStyleRegistry {
  private readonly settings: NodeStyleSettings;

  constructor(settings = loadNodeStyleSettings()) {
    this.settings = normalizeSettings(settings);
  }

  getColor(type: unknown): string {
    return this.settings.colors[normalizeNodeType(type)];
  }

  getSizeMultiplier(type: unknown): number {
    return this.settings.sizeMultipliers[normalizeNodeType(type)];
  }

  getSettings(): NodeStyleSettings {
    return {
      ...this.settings,
      colors: { ...this.settings.colors },
      sizeMultipliers: { ...this.settings.sizeMultipliers },
    };
  }
}

export function createNodeStyleRegistry(settings?: NodeStyleSettings): NodeStyleRegistry {
  return new NodeStyleRegistry(settings);
}
