import { describe, expect, it } from '@rstest/core';
import {
  LEDGER_ACTIONS,
  LedgerAuthorizationError,
  checkLedgerAction,
  requireLedgerAction,
} from './authorization';

describe('ledger authorization', () => {
  it.each([
    ['manage', 'health-ledger.manage', 'plan'],
    ['research', 'health-ledger.research', 'plan'],
    ['export', 'health-ledger.export', 'do'],
  ] as const)(
    'checks %s through the canonical SDK authorization contract',
    async (action, actionId, autonomy) => {
      const requests: unknown[] = [];

      await expect(
        checkLedgerAction(action, async options => {
          requests.push(options);
          return { allowed: true };
        }),
      ).resolves.toBe(true);
      expect(requests).toEqual([{ actionId, autonomy }]);
      expect(LEDGER_ACTIONS[action]).toMatchObject({ actionId, autonomy });
    },
  );

  it('fails closed before a denied boundary can continue', async () => {
    await expect(
      requireLedgerAction('research', async () => ({ allowed: false })),
    ).rejects.toEqual(
      expect.objectContaining<Partial<LedgerAuthorizationError>>({
        name: 'LedgerAuthorizationError',
        action: 'research',
        message:
          'TAP did not grant health-ledger.research; this package cannot run health research.',
      }),
    );
  });
});
