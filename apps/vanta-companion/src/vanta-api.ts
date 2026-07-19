import type {
  MiniAppHttpRequestInput,
  MiniAppHttpResponse,
} from '@theaiplatform/miniapp-sdk/sdk';

export const VANTA_API_ORIGIN = 'https://api.vanta.com';

export const VANTA_API_SURFACES = [
  {
    id: 'auditor',
    label: 'Auditor API',
    description: 'Audits, information requests, evidence, and comments.',
    examplePath: '/v1/audits?pageSize=10',
  },
  {
    id: 'manage',
    label: 'Manage Vanta API',
    description: 'Controls, tests, people, vendors, risks, and Trust Center.',
    examplePath: '/v1/controls?pageSize=10',
  },
  {
    id: 'build-integrations',
    label: 'Build Integrations API',
    description: 'Integration resource kinds, custom resources, and test data.',
    examplePath: '/v1/integrations/{integrationId}/resource-kinds',
  },
] as const;

export type VantaApiSurface = (typeof VANTA_API_SURFACES)[number]['id'];
export type VantaApiMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface VantaApiDraft {
  readonly surface: VantaApiSurface;
  readonly credentialRef: string;
  readonly method: VantaApiMethod;
  readonly path: string;
  readonly body: string;
}

export interface VantaApiDisplayResult {
  readonly response: MiniAppHttpResponse;
  readonly body: string;
}

const READ_METHODS = new Set<VantaApiMethod>(['GET', 'HEAD']);
const DISPLAY_BODY_LIMIT = 64 * 1024;

export const isVantaApiWrite = (method: VantaApiMethod): boolean =>
  !READ_METHODS.has(method);

export function normalizeVantaApiUrl(pathOrUrl: string): string {
  const value = pathOrUrl.trim();
  if (!value) throw new Error('A Vanta API path is required.');

  let url: URL;
  try {
    url = new URL(value, VANTA_API_ORIGIN);
  } catch {
    throw new Error('Enter a valid Vanta API path or URL.');
  }

  if (url.origin !== VANTA_API_ORIGIN) {
    throw new Error(`Vanta API requests must target ${VANTA_API_ORIGIN}.`);
  }
  if (url.username || url.password || url.hash) {
    throw new Error('Vanta API URLs cannot contain credentials or fragments.');
  }
  if (url.pathname !== '/v1' && !url.pathname.startsWith('/v1/')) {
    throw new Error('Vanta API requests must use a documented /v1 endpoint.');
  }

  return url.toString();
}

export function buildVantaApiRequest(
  draft: VantaApiDraft,
): MiniAppHttpRequestInput {
  if (!draft.credentialRef.trim()) {
    throw new Error('Select a host-managed Vanta credential.');
  }

  const body = draft.body.trim();
  if (!isVantaApiWrite(draft.method) && body) {
    throw new Error(`${draft.method} requests cannot include a body.`);
  }

  let normalizedBody: string | null = null;
  if (body) {
    try {
      normalizedBody = JSON.stringify(JSON.parse(body));
    } catch {
      throw new Error('Request body must be valid JSON.');
    }
  }

  return {
    method: draft.method,
    url: normalizeVantaApiUrl(draft.path),
    headers: [
      { name: 'Accept', value: 'application/json' },
      ...(normalizedBody
        ? [{ name: 'Content-Type', value: 'application/json' }]
        : []),
    ],
    body: normalizedBody,
    timeoutMs: 30_000,
    responseBodyLimitBytes: 1024 * 1024,
    followRedirects: false,
  };
}

export function formatVantaApiResponse(
  response: MiniAppHttpResponse,
): VantaApiDisplayResult {
  if (response.bodyKind === 'binary') {
    return {
      response,
      body: `[Binary response omitted · ${response.sizeBytes.toLocaleString()} bytes]`,
    };
  }

  const source = response.bodyText ?? '';
  let formatted = source;
  if (source) {
    try {
      formatted = JSON.stringify(JSON.parse(source), null, 2);
    } catch {
      // Preserve non-JSON API error bodies as returned by Vanta.
    }
  }
  if (formatted.length > DISPLAY_BODY_LIMIT) {
    formatted = `${formatted.slice(0, DISPLAY_BODY_LIMIT)}\n… response display truncated`;
  }

  return { response, body: formatted || '[No response body]' };
}

export const isSuccessfulVantaResponse = (
  response: MiniAppHttpResponse,
): boolean => response.status >= 200 && response.status < 300;
