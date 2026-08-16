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
      samples.sort((a, b) => a - b);
      const median = samples[Math.floor(samples.length / 2)] || 1000 / 60;
      resolve(Math.max(30, Math.min(360, Math.round(1000 / median))));
    };
    requestAnimationFrame(sample);
  });
}
