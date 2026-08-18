export const EXTERNAL_LINKS = {
  omm: 'https://github.com/Xuepoo/oh-my-mystery',
  vectojs: 'https://github.com/vectojs/vectojs',
} as const;

const ALLOWED_EXTERNAL_LINKS = new Set<string>(Object.values(EXTERNAL_LINKS));

export function openAllowedExternalLink(url: string): boolean {
  if (!ALLOWED_EXTERNAL_LINKS.has(url) || typeof window === 'undefined') return false;
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (opened) opened.opener = null;
  return opened !== null;
}
