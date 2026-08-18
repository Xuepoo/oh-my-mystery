type TurnstileWidget = {
  reset: (widgetId: string) => void;
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
};

declare global {
  interface Window {
    turnstile?: TurnstileWidget;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(timeoutMs: number): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const finish = (callback: () => void) => {
      clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      callback();
    };
    const timeout = setTimeout(
      () =>
        finish(() => {
          script.remove();
          reject(new Error('Turnstile script loading timed out'));
        }),
      timeoutMs,
    );
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => finish(resolve);
    script.onerror = () =>
      finish(() => {
        script.remove();
        reject(new Error('Unable to load Turnstile'));
      });
    document.head.appendChild(script);
  });
  scriptPromise.catch(() => {
    scriptPromise = null;
  });
  return scriptPromise;
}

export async function getTurnstileToken(
  siteKey: string | undefined,
  options: { timeoutMs?: number; retries?: number; signal?: AbortSignal } = {},
): Promise<string | null> {
  if (!siteKey || typeof window === 'undefined' || typeof document === 'undefined') return null;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const attempts = Math.max(1, (options.retries ?? 1) + 1);
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      options.signal?.throwIfAborted();
      await raceWithSignal(loadScript(timeoutMs), options.signal);
      if (!window.turnstile) throw new Error('Turnstile is unavailable');
      return await requestToken(siteKey, timeoutMs, options.signal);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function raceWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function requestToken(siteKey: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  const container = document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  container.style.display = 'none';
  document.body.appendChild(container);
  return new Promise((resolve, reject) => {
    let widgetId = '';
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      if (widgetId) {
        try {
          window.turnstile?.reset(widgetId);
        } catch {}
      }
      container.remove();
      callback();
    };
    const abort = () => finish(() => reject(signal?.reason));
    timeout = setTimeout(
      () => finish(() => reject(new Error('Turnstile verification timed out'))),
      timeoutMs,
    );
    signal?.addEventListener('abort', abort, { once: true });
    try {
      signal?.throwIfAborted();
      widgetId = window.turnstile!.render(container, {
        sitekey: siteKey,
        size: 'invisible',
        callback: (token: unknown) => {
          if (typeof token !== 'string' || token.length === 0) {
            finish(() => reject(new Error('Turnstile returned an invalid token')));
            return;
          }
          finish(() => resolve(token));
        },
        'error-callback': () => finish(() => reject(new Error('Turnstile verification failed'))),
        'expired-callback': () => finish(() => reject(new Error('Turnstile token expired'))),
      });
    } catch (error) {
      finish(() => reject(error));
    }
  });
}
