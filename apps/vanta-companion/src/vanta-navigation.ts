export type ExternalWindowOpener = (
  url: string,
  target: string,
  features: string,
) => Window | null;

export function openVantaSource(
  value: string,
  open: ExternalWindowOpener = globalThis.open,
): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('The Vanta source link is invalid.');
  }
  if (
    url.protocol !== 'https:' ||
    (url.hostname !== 'vanta.com' && !url.hostname.endsWith('.vanta.com'))
  ) {
    throw new Error('The source link must use an HTTPS Vanta domain.');
  }
  if (!open(url.toString(), '_blank', 'noopener,noreferrer')) {
    throw new Error(
      'The Vanta window was blocked. Allow pop-ups for this TAP host and retry.',
    );
  }
}
