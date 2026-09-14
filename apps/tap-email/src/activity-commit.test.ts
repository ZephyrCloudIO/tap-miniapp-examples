import { describe, expect, it, rs } from '@rstest/core';
import { commitActivityBeforeSettlement } from './activity-commit';

describe('terminal activity settlement barrier', () => {
  it('keeps the command recoverable while bookkeeping fails, then settles exactly once', async () => {
    const durableCommands = ['cmd_1'];
    const providerMutation = rs.fn(async () => undefined);
    let commitAttempts = 0;
    const commit = rs.fn(async () => {
      commitAttempts += 1;
      if (commitAttempts === 1) throw new Error('profile SQLite unavailable');
    });
    const recoverableSnapshots: string[][] = [];
    const settle = rs.fn(() => {
      durableCommands.splice(0, durableCommands.length);
    });

    // Provider work happens once, before this bookkeeping-only retry barrier.
    await providerMutation();
    const result = await commitActivityBeforeSettlement({
      commit,
      settle,
      waitForRetry: async () => {
        recoverableSnapshots.push([...durableCommands]);
        return true;
      },
    });

    expect(result).toBe('settled');
    expect(providerMutation).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(recoverableSnapshots).toEqual([['cmd_1']]);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(durableCommands).toEqual([]);
  });

  it('defers settlement on teardown so the durable command can reconcile next mount', async () => {
    const durableCommands = ['cmd_1'];
    let active = true;
    const managedProviderReconciliation = rs.fn(async () => undefined);
    const settle = rs.fn(() => {
      durableCommands.splice(0, durableCommands.length);
    });

    // The managed provider check happens once, before bookkeeping. A failed
    // activity commit must leave the Outbox state intact and must not cause an
    // automatic second provider reconciliation.
    await managedProviderReconciliation();
    const result = await commitActivityBeforeSettlement({
      commit: async () => {
        throw new Error('projection publication unavailable');
      },
      settle,
      canSettle: () => active,
      waitForRetry: async () => {
        active = false;
        return false;
      },
    });

    expect(result).toBe('deferred');
    expect(managedProviderReconciliation).toHaveBeenCalledTimes(1);
    expect(settle).not.toHaveBeenCalled();
    expect(durableCommands).toEqual(['cmd_1']);
  });
});
