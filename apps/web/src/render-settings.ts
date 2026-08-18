export type FpsChoice = 60 | 120 | 'max';
export type PointBackendChoice = 'canvas' | 'webgl';
export type ParticleBackendChoice = 'webgpu' | 'cpu';

export interface RenderSettings {
  fps: FpsChoice;
  pointBackend: PointBackendChoice;
  particleBackend: ParticleBackendChoice;
}

const STORAGE_KEY = 'omm-render-settings-v1';

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  fps: 60,
  pointBackend: 'canvas',
  particleBackend: 'webgpu',
};

export function loadRenderSettings(): RenderSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_RENDER_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<RenderSettings>;
    return {
      fps: parsed.fps === 120 || parsed.fps === 'max' ? parsed.fps : 60,
      pointBackend: parsed.pointBackend === 'webgl' ? 'webgl' : 'canvas',
      particleBackend: parsed.particleBackend === 'cpu' ? 'cpu' : 'webgpu',
    };
  } catch {
    return { ...DEFAULT_RENDER_SETTINGS };
  }
}

export function saveRenderSettings(settings: RenderSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

const COMMON_REFRESH_RATES = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 200, 240, 360];

export function estimateDisplayRefresh(intervals: readonly number[]): number {
  const valid = intervals.filter((value) => Number.isFinite(value) && value >= 2.5 && value <= 40);
  if (valid.length < 5) return 60;

  const sorted = [...valid].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const shortCount = sorted.filter((value) => value < median * 0.75).length;
  const includeShortCadence = shortCount / sorted.length >= 0.3;
  const stable = sorted.filter(
    (value) => value <= median * 1.6 && (includeShortCadence || value >= median * 0.75),
  );
  const mean = stable.reduce((sum, value) => sum + value, 0) / stable.length;
  const measured = 1000 / mean;
  const nearest = COMMON_REFRESH_RATES.reduce((best, rate) =>
    Math.abs(rate - measured) < Math.abs(best - measured) ? rate : best,
  );

  // Aggregate intervals preserve quantized cadence mixtures (for example
  // 8/8/4 ms at 144 Hz), while the common-mode snap removes timer jitter.
  return Math.abs(nearest - measured) / nearest <= 0.08 ? nearest : 60;
}

export async function measureDisplayRefresh(durationMs = 700): Promise<number> {
  const samples: number[] = [];
  let previous = 0;
  const started = performance.now();
  return new Promise((resolve) => {
    const sample = (now: number) => {
      if (previous > 0) samples.push(now - previous);
      previous = now;
      if (now - started < durationMs) {
        requestAnimationFrame(sample);
        return;
      }
      resolve(estimateDisplayRefresh(samples));
    };
    requestAnimationFrame(sample);
  });
}
