export interface ActivityCommitRetryOptions {
  /**
   * Records the already-terminal provider receipt and publishes its
   * content-free activity projection. Implementations must be idempotent.
   */
  readonly commit: () => Promise<void>;
  /** Removes the command from the durable dispatch queue. */
  readonly settle: () => void | Promise<void>;
  /**
   * Waits before another bookkeeping attempt. Returning false leaves the
   * command queued so a later mount can reconcile the same terminal receipt.
   */
  readonly waitForRetry: (
    error: unknown,
    failedAttempts: number,
  ) => boolean | Promise<boolean>;
  /** Prevents a successful late attempt from updating an unmounted surface. */
  readonly canSettle?: () => boolean;
}

/**
 * Treat activity bookkeeping as part of terminal command settlement, without
 * ever repeating the provider mutation in this retry loop. The immutable mail
 * command remains in local state until its receipt is durably reflected in the
 * content-free activity projection. If the surface goes away, the command is
 * intentionally left for the normal idempotent coordinator reconciliation on
 * the next mount.
 */
export async function commitActivityBeforeSettlement({
  commit,
  settle,
  waitForRetry,
  canSettle = () => true,
}: ActivityCommitRetryOptions): Promise<'settled' | 'deferred'> {
  let failedAttempts = 0;
  while (canSettle()) {
    try {
      await commit();
      if (!canSettle()) return 'deferred';
      await settle();
      return 'settled';
    } catch (error) {
      failedAttempts += 1;
      if (!canSettle() || !(await waitForRetry(error, failedAttempts))) {
        return 'deferred';
      }
    }
  }
  return 'deferred';
}
