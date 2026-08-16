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

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Unable to load Turnstile'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export async function getTurnstileToken(siteKey: string | undefined): Promise<string | null> {
  if (!siteKey || typeof window === 'undefined' || typeof document === 'undefined') return null;
  await loadScript();
  if (!window.turnstile) throw new Error('Turnstile is unavailable');
  const container = document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  container.style.display = 'none';
  document.body.appendChild(container);
  return new Promise((resolve, reject) => {
    let widgetId = '';
    const finish = (callback: () => void) => {
      if (widgetId) window.turnstile?.reset(widgetId);
      container.remove();
      callback();
    };
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
  });
}
