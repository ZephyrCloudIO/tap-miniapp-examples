/** The website owns this campaign; no identity or redirect overrides travel in the URL. */
export function isTapEmailReferralUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2_048 || /[\s\u0000-\u001f\u007f]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return url.origin === 'https://theaiplatform.app' &&
      /^\/refer\/[a-f0-9]{32}$/u.test(url.pathname) &&
      !url.username && !url.password && !url.hash &&
      url.searchParams.size === 4 &&
      url.searchParams.get('utm_source') === 'tap_email' &&
      url.searchParams.get('utm_medium') === 'email' &&
      url.searchParams.get('utm_campaign') === 'sent_with' &&
      url.searchParams.get('utm_content') === 'signature';
  } catch {
    return false;
  }
}
