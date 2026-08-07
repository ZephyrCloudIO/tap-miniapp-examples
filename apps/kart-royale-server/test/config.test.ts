import { describe, expect, it } from 'vitest';
import { raceFieldSize } from '../src/config';

describe('race field configuration', () => {
  it('counts AI backfill in the same bounded field used by item placement', () => {
    expect(raceFieldSize('8')).toBe(8);
    expect(raceFieldSize('4')).toBe(4);
    expect(raceFieldSize(undefined)).toBe(8);
    expect(raceFieldSize('0')).toBe(8);
    expect(raceFieldSize('9')).toBe(8);
    expect(raceFieldSize('not-a-number')).toBe(8);
  });
});
