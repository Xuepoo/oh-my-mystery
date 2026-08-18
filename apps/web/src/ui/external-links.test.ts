import { afterEach, describe, expect, mock, test } from 'bun:test';
import { EXTERNAL_LINKS, openAllowedExternalLink } from './external-links';

describe('external link allowlist', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    globalThis.window = originalWindow;
  });
  test('contains the fixed project destinations', () => {
    expect(EXTERNAL_LINKS).toEqual({
      omm: 'https://github.com/Xuepoo/oh-my-mystery',
      vectojs: 'https://github.com/vectojs/vectojs',
    });
  });

  test('rejects arbitrary destinations without a browser', () => {
    expect(openAllowedExternalLink('https://example.com')).toBe(false);
  });

  test('opens allowed destinations with isolation and reports blocked popups', () => {
    const open = mock(() => ({ opener: globalThis }));
    globalThis.window = { open } as unknown as Window & typeof globalThis;
    expect(openAllowedExternalLink(EXTERNAL_LINKS.vectojs)).toBe(true);
    expect(open).toHaveBeenCalledWith(
      'https://github.com/vectojs/vectojs',
      '_blank',
      'noopener,noreferrer',
    );
    expect(open.mock.results[0]!.value.opener).toBeNull();

    globalThis.window = { open: () => null } as unknown as Window & typeof globalThis;
    expect(openAllowedExternalLink(EXTERNAL_LINKS.omm)).toBe(false);
  });
});
