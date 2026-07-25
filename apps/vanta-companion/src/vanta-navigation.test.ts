import { describe, expect, it } from '@rstest/core';
import { openVantaSource } from './vanta-navigation';

describe('Vanta source navigation', () => {
  it('opens only HTTPS Vanta domains with opener isolation', () => {
    const calls: string[][] = [];
    openVantaSource(
      'https://app.vanta.com/tests/test-123',
      (url, target, features) => {
        calls.push([url, target, features]);
        return {} as Window;
      },
    );
    expect(calls).toEqual([
      [
        'https://app.vanta.com/tests/test-123',
        '_blank',
        'noopener,noreferrer',
      ],
    ]);
  });

  it('rejects untrusted domains and blocked windows', () => {
    expect(() =>
      openVantaSource('https://vanta.com.example.org/tests/123', () => ({} as Window)),
    ).toThrow('HTTPS Vanta domain');
    expect(() =>
      openVantaSource('https://app.vanta.com/tests/123', () => null),
    ).toThrow('window was blocked');
  });
});
