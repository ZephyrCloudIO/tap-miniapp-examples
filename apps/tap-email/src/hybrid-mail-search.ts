import { reciprocalRankFusion } from '@theaiplatform/miniapp-sdk/sdk';

/**
 * Combines deterministic local matches and local-vector matches without
 * coupling either index to the other. Exact matches receive a modest weight,
 * while semantic-only results remain eligible.
 */
export function fuseMailSearchRanks(
  deterministicThreadKeys: readonly string[],
  semanticThreadKeys: readonly string[],
  limit = 100,
): readonly string[] {
  const lists = [deterministicThreadKeys, semanticThreadKeys]
    .map(keys => [...new Set(keys)].map(key => ({ id: key, value: key })));
  return reciprocalRankFusion(lists, {
    weights: [1.2, 1],
    rankConstant: 60,
    limit,
  }).map(item => item.value);
}
