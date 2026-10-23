// Unset or invalid CRM_API_URL turns CRM delivery off, so development and staging
// never write to the production CRM by accident.
export const resolveCrmApiUrl = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  return url.origin + url.pathname.replace(/\/+$/u, "");
};

// The booking page is the path below the public booking origin. Never the full URL,
// and never the management link or its token.
export const crmBookingPage = (profileSlug: string, eventTypeSlug: string): string =>
  `${profileSlug}/${eventTypeSlug}`;
