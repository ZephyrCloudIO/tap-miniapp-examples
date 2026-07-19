import { describe, expect, it } from '@rstest/core';
import {
  buildVantaApiRequest,
  formatVantaApiResponse,
  isVantaApiWrite,
  normalizeVantaApiUrl,
  type VantaApiDraft,
} from './vanta-api';

const draft = (input: Partial<VantaApiDraft> = {}): VantaApiDraft => ({
  surface: 'auditor',
  credentialRef: 'credential-1',
  method: 'GET',
  path: '/v1/audits?pageSize=10',
  body: '',
  ...input,
});

describe('Vanta host HTTP adapter', () => {
  it('allows only documented v1 endpoints on the Vanta API origin', () => {
    expect(normalizeVantaApiUrl('/v1/audits?pageSize=10')).toBe(
      'https://api.vanta.com/v1/audits?pageSize=10',
    );
    expect(
      normalizeVantaApiUrl('https://api.vanta.com/v1/controls'),
    ).toBe('https://api.vanta.com/v1/controls');
    expect(() => normalizeVantaApiUrl('https://example.com/v1/audits')).toThrow(
      'must target',
    );
    expect(() => normalizeVantaApiUrl('/oauth/token')).toThrow('/v1');
    expect(() => normalizeVantaApiUrl('/v1/../oauth/token')).toThrow('/v1');
    expect(() => normalizeVantaApiUrl('/v1/audits#token')).toThrow(
      'fragments',
    );
  });

  it('builds a bounded credential-injected request without an auth header', () => {
    expect(
      buildVantaApiRequest(
        draft({
          surface: 'manage',
          method: 'POST',
          path: '/v1/people/offboard',
          body: '{ "updates": [] }',
        }),
      ),
    ).toEqual({
      method: 'POST',
      url: 'https://api.vanta.com/v1/people/offboard',
      headers: [
        { name: 'Accept', value: 'application/json' },
        { name: 'Content-Type', value: 'application/json' },
      ],
      body: '{"updates":[]}',
      timeoutMs: 30_000,
      responseBodyLimitBytes: 1024 * 1024,
      followRedirects: false,
    });
  });

  it('rejects missing credentials, read bodies, and invalid JSON', () => {
    expect(() =>
      buildVantaApiRequest(draft({ credentialRef: ' ' })),
    ).toThrow('host-managed');
    expect(() => buildVantaApiRequest(draft({ body: '{}' }))).toThrow(
      'cannot include a body',
    );
    expect(() =>
      buildVantaApiRequest(draft({ method: 'PATCH', body: '{' })),
    ).toThrow('valid JSON');
  });

  it('classifies every mutating method as a fresh-decision write', () => {
    expect(isVantaApiWrite('GET')).toBe(false);
    expect(isVantaApiWrite('HEAD')).toBe(false);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      expect(isVantaApiWrite(method)).toBe(true);
    }
  });

  it('pretty-prints JSON and omits binary response bodies', () => {
    const response = {
      finalUrl: 'https://api.vanta.com/v1/audits',
      status: 200,
      statusText: 'OK',
      headers: [],
      bodyText: '{"results":[]}',
      bodyBase64: null,
      bodyKind: 'text' as const,
      bodyTruncated: false,
      sizeBytes: 14,
      elapsedMs: 20,
      contentType: 'application/json',
    };
    expect(formatVantaApiResponse(response).body).toBe(
      '{\n  "results": []\n}',
    );
    expect(
      formatVantaApiResponse({
        ...response,
        bodyText: null,
        bodyBase64: 'AA==',
        bodyKind: 'binary',
      }).body,
    ).toContain('Binary response omitted');
  });
});
