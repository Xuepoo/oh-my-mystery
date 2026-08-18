import { afterEach, describe, expect, it } from 'bun:test';
import { getTurnstileToken } from './turnstile';

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: originalWindow,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: originalDocument,
  });
});

describe('getTurnstileToken', () => {
  it('times out one challenge and retries once', async () => {
    let renders = 0;
    const removed: string[] = [];
    const documentMock = {
      createElement: () => ({
        setAttribute() {},
        style: {},
        remove() {
          removed.push('removed');
        },
      }),
      body: { appendChild() {} },
    };
    const windowMock = {
      turnstile: {
        reset() {},
        render(_container: HTMLElement, options: Record<string, unknown>) {
          renders++;
          if (renders === 2)
            queueMicrotask(() => (options.callback as (token: string) => void)('token'));
          return `widget-${renders}`;
        },
      },
    };
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: windowMock,
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      writable: true,
      value: documentMock,
    });

    await expect(getTurnstileToken('site-key', { timeoutMs: 5, retries: 1 })).resolves.toBe(
      'token',
    );
    expect(renders).toBe(2);
    expect(removed).toHaveLength(2);
  });

  it('cleans up when widget rendering throws synchronously', async () => {
    let removed = 0;
    const documentMock = {
      createElement: () => ({
        setAttribute() {},
        style: {},
        remove() {
          removed++;
        },
      }),
      body: { appendChild() {} },
    };
    const windowMock = {
      turnstile: {
        reset() {},
        render() {
          throw new Error('render failed');
        },
      },
    };
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: windowMock,
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      writable: true,
      value: documentMock,
    });

    await expect(getTurnstileToken('site-key', { retries: 0 })).rejects.toThrow('render failed');
    expect(removed).toBe(1);
  });
});
