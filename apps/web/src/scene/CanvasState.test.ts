import { describe, expect, it } from 'bun:test';
import { BackgroundLayer } from './BackgroundLayer';
import { GraphOverlayLayer } from './GraphOverlayLayer';

function stateTrackingContext() {
  const calls: string[] = [];
  const ctx = {
    globalAlpha: 0.2,
    globalCompositeOperation: 'xor',
    shadowBlur: 12,
    shadowOffsetX: 4,
    shadowOffsetY: 5,
    save() {
      calls.push('save');
    },
    restore() {
      calls.push('restore');
    },
    resetTransform() {
      calls.push('resetTransform');
    },
    fillRect() {
      calls.push('fillRect');
    },
    setTransform() {
      calls.push('setTransform');
    },
  } as unknown as CanvasRenderingContext2D;
  return { calls, ctx };
}

describe('scene Canvas state isolation', () => {
  it('resets hostile Canvas state and balances the background render boundary', () => {
    const { calls, ctx } = stateTrackingContext();
    const layer = Object.create(BackgroundLayer.prototype) as BackgroundLayer &
      Record<string, unknown>;
    Object.defineProperty(layer, 'scene', {
      value: { width: 320, height: 180, markDirty() {} },
    });
    layer['renderFrame'] = (frameCtx: CanvasRenderingContext2D) => {
      expect(frameCtx.globalAlpha).toBe(1);
      expect(frameCtx.globalCompositeOperation).toBe('source-over');
      expect(frameCtx.shadowBlur).toBe(0);
      expect(frameCtx.shadowOffsetX).toBe(0);
      expect(frameCtx.shadowOffsetY).toBe(0);
    };

    layer.render({ ctx });

    expect(calls).toEqual(['save', 'resetTransform', 'fillRect', 'setTransform', 'restore']);
  });

  it('balances the graph overlay render boundary when rendering throws', () => {
    const { calls, ctx } = stateTrackingContext();
    const layer = Object.create(GraphOverlayLayer.prototype) as GraphOverlayLayer &
      Record<string, unknown>;
    layer['renderFrame'] = () => {
      throw new Error('render failed');
    };

    expect(() => layer.render({ ctx })).toThrow('render failed');
    expect(calls).toEqual(['save', 'restore']);
  });
});
