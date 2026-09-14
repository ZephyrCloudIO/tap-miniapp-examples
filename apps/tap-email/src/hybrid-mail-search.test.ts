import { describe, expect, it } from '@rstest/core';
import { fuseMailSearchRanks } from './hybrid-mail-search';

describe('hybrid mail search ranking', () => {
  it('keeps exact results prominent while retaining semantic-only matches', () => {
    expect(fuseMailSearchRanks(
      ['exact-first', 'both', 'exact-last'],
      ['semantic-first', 'both', 'semantic-last'],
    )).toEqual([
      'both',
      'exact-first',
      'exact-last',
      'semantic-first',
      'semantic-last',
    ]);
  });

  it('deduplicates each source and honors a result limit', () => {
    expect(fuseMailSearchRanks(['one', 'one', 'two'], ['two', 'three'], 2))
      .toEqual(['two', 'one']);
  });
});
