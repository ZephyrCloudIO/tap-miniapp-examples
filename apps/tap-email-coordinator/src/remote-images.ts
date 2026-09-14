const maximumBatchSize = 32;
const maximumConcurrentFetches = 4;
const maximumUrlLength = 4_096;
const maximumImageBytes = 2 * 1_024 * 1_024;
const maximumBatchBytes = 6 * 1_024 * 1_024;
const maximumRedirects = 3;
const fetchTimeoutMs = 10_000;
const batchTimeoutMs = 24_000;

const supportedImageTypes = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export interface ProxiedRemoteImage {
  readonly url: string;
  readonly dataUrl: string;
  readonly sizeBytes: number;
}

export interface BlockedRemoteImage {
  readonly url: string;
  readonly reason:
    | 'fetch_failed'
    | 'non_image'
    | 'too_large'
    | 'unsafe_redirect'
    | 'unsafe_url';
}

export interface RemoteImageBatchResult {
  readonly images: readonly ProxiedRemoteImage[];
  readonly blocked: readonly BlockedRemoteImage[];
}

export type RemoteImageFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type RemoteImageBatchLoader = (
  urls: readonly string[],
) => Promise<RemoteImageBatchResult>;

export class RemoteImageProxyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function remoteImageUrlsFromRequest(value: unknown): readonly string[] {
  if (!isRecord(value) || !Array.isArray(value.urls)) {
    throw new RemoteImageProxyError(
      400,
      'invalid_remote_images',
      'Supply a bounded list of remote image URLs.',
    );
  }
  if (value.urls.length === 0 || value.urls.length > maximumBatchSize) {
    throw new RemoteImageProxyError(
      400,
      'invalid_remote_images',
      `Supply between 1 and ${maximumBatchSize} remote image URLs.`,
    );
  }
  const urls: string[] = [];
  for (const candidate of value.urls) {
    if (
      typeof candidate !== 'string' ||
      candidate.length === 0 ||
      candidate.length > maximumUrlLength
    ) {
      throw new RemoteImageProxyError(
        400,
        'invalid_remote_images',
        'Every remote image URL must be a bounded string.',
      );
    }
    if (!urls.includes(candidate)) urls.push(candidate);
  }
  return urls;
}

/**
 * Intersects caller-requested URLs with image sources present in an already
 * authorized message body. Comparisons use the same URL normalization as the
 * fetcher, while results retain the caller's exact strings for client mapping.
 */
export async function remoteImageUrlsAllowedByHtml(
  html: string,
  requestedUrls: readonly string[],
): Promise<readonly string[]> {
  const requestedByNormalizedUrl = new Map<string, string[]>();
  for (const requestedUrl of requestedUrls) {
    const normalized = safeRemoteImageUrl(requestedUrl)?.href;
    if (!normalized) continue;
    const matches = requestedByNormalizedUrl.get(normalized) ?? [];
    matches.push(requestedUrl);
    requestedByNormalizedUrl.set(normalized, matches);
  }

  const allowed = new Set<string>();
  const decodeAttributeUrl = (value: string) => value
    .replace(/&(?:amp|#0*38|#x0*26);/giu, '&')
    .replace(/&(?:quot|#0*34|#x0*22);/giu, '"')
    .replace(/&(?:apos|#0*39|#x0*27);/giu, "'");
  const transformed = new HTMLRewriter()
    .on('img', {
      element(element) {
        const source = element.getAttribute('src');
        if (!source) return;
        const normalized = safeRemoteImageUrl(decodeAttributeUrl(source))?.href;
        if (!normalized) return;
        for (const requestedUrl of requestedByNormalizedUrl.get(normalized) ?? []) {
          allowed.add(requestedUrl);
        }
      },
    })
    .transform(new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }));
  // Drive HTMLRewriter to completion; it parses lazily as the body is consumed.
  await transformed.arrayBuffer();
  return requestedUrls.filter(url => allowed.has(url));
}

function ipv4Parts(hostname: string): readonly number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)) return null;
  const parts = hostname.split('.').map(Number);
  return parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

function isPrivateOrReservedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (
    normalized.endsWith('.') ||
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal')
  ) {
    return true;
  }
  const parts = ipv4Parts(normalized);
  // Remote mail images have no legitimate need for literal IP targets. Banning
  // all of them also closes alternate IPv4 and IPv4-mapped IPv6 spellings that
  // are easy to miss with blocklist-only parsing.
  if (parts || normalized.includes(':')) return true;
  // Public HTTPS hosts are DNS names. Dotless names can resolve through local
  // search domains and therefore are not appropriate proxy targets.
  return !normalized.includes('.');
}

export function safeRemoteImageUrl(value: string): URL | null {
  if (value.length === 0 || value.length > maximumUrlLength) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== '443') ||
    isPrivateOrReservedHostname(parsed.hostname)
  ) {
    return null;
  }
  parsed.hash = '';
  return parsed;
}

async function readBoundedBytes(
  response: Response,
  maximum: number,
): Promise<Uint8Array | null> {
  const declaredValue = response.headers.get('Content-Length');
  if (declaredValue) {
    const declared = Number(declaredValue);
    if (Number.isFinite(declared) && declared > maximum) {
      await response.body?.cancel('remote image too large');
      return null;
    }
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maximum) {
      await reader.cancel('remote image too large');
      return null;
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return btoa(chunks.join(''));
}

function bytesStartWith(bytes: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function matchesDeclaredImageType(bytes: Uint8Array, contentType: string): boolean {
  if (contentType === 'image/jpeg') {
    return bytesStartWith(bytes, [0xff, 0xd8, 0xff]);
  }
  if (contentType === 'image/png') {
    return bytesStartWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (contentType === 'image/gif') {
    const signature = asciiAt(bytes, 0, 6);
    return signature === 'GIF87a' || signature === 'GIF89a';
  }
  if (contentType === 'image/webp') {
    return asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 4) === 'WEBP';
  }
  if (contentType === 'image/avif') {
    if (asciiAt(bytes, 4, 4) !== 'ftyp') return false;
    const brand = asciiAt(bytes, 8, 4);
    return brand === 'avif' || brand === 'avis';
  }
  return false;
}

async function fetchOneRemoteImage(
  sourceUrl: string,
  fetcher: RemoteImageFetcher,
  timeoutMs = fetchTimeoutMs,
): Promise<ProxiedRemoteImage | BlockedRemoteImage> {
  let current = safeRemoteImageUrl(sourceUrl);
  if (!current) return { url: sourceUrl, reason: 'unsafe_url' };

  for (let redirect = 0; redirect <= maximumRedirects; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('remote image timed out'), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetcher(current, {
          headers: {
            Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9',
            'User-Agent': 'TAP-Email-Image-Proxy/1.0',
          },
          redirect: 'manual',
          signal: controller.signal,
        });
      } catch {
        return { url: sourceUrl, reason: 'fetch_failed' };
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('Location');
        await response.body?.cancel();
        if (!location || redirect === maximumRedirects) {
          return { url: sourceUrl, reason: 'unsafe_redirect' };
        }
        let redirected: URL;
        try {
          redirected = new URL(location, current);
        } catch {
          return { url: sourceUrl, reason: 'unsafe_redirect' };
        }
        current = safeRemoteImageUrl(redirected.href);
        if (!current) return { url: sourceUrl, reason: 'unsafe_redirect' };
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel();
        return { url: sourceUrl, reason: 'fetch_failed' };
      }
      const contentType = response.headers
        .get('Content-Type')
        ?.split(';', 1)[0]
        ?.trim()
        .toLowerCase();
      if (!contentType || !supportedImageTypes.has(contentType)) {
        await response.body?.cancel();
        return { url: sourceUrl, reason: 'non_image' };
      }
      const bytes = await readBoundedBytes(response, maximumImageBytes);
      if (!bytes) return { url: sourceUrl, reason: 'too_large' };
      if (!matchesDeclaredImageType(bytes, contentType)) {
        return { url: sourceUrl, reason: 'non_image' };
      }
      return {
        url: sourceUrl,
        dataUrl: `data:${contentType};base64,${toBase64(bytes)}`,
        sizeBytes: bytes.byteLength,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
  return { url: sourceUrl, reason: 'unsafe_redirect' };
}

export async function proxyRemoteImages(
  urls: readonly string[],
  fetcher: RemoteImageFetcher = fetch,
): Promise<RemoteImageBatchResult> {
  if (urls.length === 0 || urls.length > maximumBatchSize) {
    throw new RemoteImageProxyError(
      400,
      'invalid_remote_images',
      `Supply between 1 and ${maximumBatchSize} remote image URLs.`,
    );
  }
  const uniqueUrls = [...new Set(urls)];
  const images: ProxiedRemoteImage[] = [];
  const blocked: BlockedRemoteImage[] = [];
  let acceptedBytes = 0;
  const deadline = Date.now() + batchTimeoutMs;

  // Process bounded groups so rejected images are released before another
  // group starts. Retaining base64 for all 32 maximum-sized responses at once
  // could otherwise consume most of a Worker's memory before the batch budget
  // is applied.
  for (let offset = 0; offset < uniqueUrls.length; offset += maximumConcurrentFetches) {
    const group = uniqueUrls.slice(offset, offset + maximumConcurrentFetches);
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      blocked.push(...uniqueUrls.slice(offset).map(url => ({
        url,
        reason: 'fetch_failed' as const,
      })));
      break;
    }
    const results = await Promise.all(
      group.map(url => fetchOneRemoteImage(
        url,
        fetcher,
        Math.min(fetchTimeoutMs, remainingMs),
      )),
    );
    for (const result of results) {
      if ('dataUrl' in result) {
        if (acceptedBytes + result.sizeBytes > maximumBatchBytes) {
          blocked.push({ url: result.url, reason: 'too_large' });
          continue;
        }
        acceptedBytes += result.sizeBytes;
        images.push(result);
      } else {
        blocked.push(result);
      }
    }
  }
  return { images, blocked };
}
