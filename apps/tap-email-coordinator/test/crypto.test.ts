import { describe, expect, it } from 'vitest';
import {
  decodeBase64Url,
  encodeBase64Url,
  openBoundSecret,
  openSecret,
  sealBoundSecret,
  sealSecret,
  secureRandomToken,
  sha256Base64Url,
} from '../src/crypto';

const key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const otherKey = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE';

describe('coordinator secret protection', () => {
  it('round-trips credentials through AES-GCM without storing plaintext', async () => {
    const sealed = await sealSecret('refresh-token-value', key);
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
    expect(sealed).not.toContain('refresh-token-value');
    await expect(openSecret(sealed, key)).resolves.toBe('refresh-token-value');
    await expect(openSecret(sealed, otherKey)).rejects.toThrow(
      'Encrypted credential could not be opened.',
    );
  });

  it('generates non-repeating state and stable one-way hashes', async () => {
    const first = secureRandomToken();
    const second = secureRandomToken();
    expect(first).not.toBe(second);
    await expect(sha256Base64Url(first)).resolves.toBe(
      await sha256Base64Url(first),
    );
  });

  it('binds a v2 envelope to its authenticated storage identity', async () => {
    const binding = 'mail_commands\u0000profile_1\u0000account_1\u0000cmd_1\u0000send_draft';
    const sealed = await sealBoundSecret('private draft', key, binding);
    expect(sealed).toMatch(/^v2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
    await expect(openBoundSecret(sealed, key, binding)).resolves.toBe('private draft');
    await expect(openBoundSecret(
      sealed,
      key,
      binding.replace('cmd_1', 'cmd_2'),
    )).rejects.toThrow('Encrypted bound secret could not be opened.');
  });

  it('rejects an oversized decoded value instead of returning corrupted partial text', () => {
    const encoded = encodeBase64Url('complete-value');
    expect(() => decodeBase64Url(encoded, 5)).toThrow(/exceeds 5 bytes/u);
    expect(decodeBase64Url(encoded, 100)).toBe('complete-value');
  });

  it('bounds replacement text produced by malformed provider UTF-8', () => {
    const decoded = decodeBase64Url('Qf8', 2);
    expect(decoded).toBe('A');
    expect(new TextEncoder().encode(decoded).byteLength).toBeLessThanOrEqual(2);
  });
});
