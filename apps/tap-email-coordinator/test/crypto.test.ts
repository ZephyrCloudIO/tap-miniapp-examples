import { describe, expect, it } from 'vitest';
import {
  openSecret,
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
});
