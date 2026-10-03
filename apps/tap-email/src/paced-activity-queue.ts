import { AsyncBatcher } from '@tanstack/pacer/async-batcher';
import { AsyncRetryer } from '@tanstack/pacer/async-retryer';

export const ACTIVITY_QUIET_MS = 100;
export const ACTIVITY_MAX_AGE_MS = 150;
export const ACTIVITY_BATCH_SIZE = 8;

/** Background batching with a fixed age cap and serialized, retried writes. */
export class PacedActivityQueue<T> {
  private readonly batcher: AsyncBatcher<T>;
  private ageTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<void> = Promise.resolve();
  private readonly executions = new Set<Promise<unknown>>();
  private closed = false;
  private latest: T | undefined;
  private hasLatest = false;
  private replacingLatest = false;
  private readonly retryers = new Set<AsyncRetryer<(items: readonly T[]) => Promise<void>>>();

  constructor(process: (items: readonly T[]) => Promise<void>, onError: (error: Error) => void,
    private readonly options: { readonly latestOnly?: boolean } = {}) {
    this.batcher = new AsyncBatcher(async items => {
      // Pacer permits overlapping executions; SDK writes must retain ordering.
      const task = this.pending.catch(() => undefined).then(async () => {
        if (this.closed) return;
        const retryer = new AsyncRetryer(process, { maxAttempts: 3, baseWait: 1_000,
          maxWait: 2_000, backoff: 'exponential', throwOnError: 'last' });
        this.retryers.add(retryer);
        try { await retryer.execute(items); }
        finally { this.retryers.delete(retryer); }
      });
      this.pending = task;
      this.track(task);
      await task;
    }, {
      wait: ACTIVITY_QUIET_MS, maxSize: ACTIVITY_BATCH_SIZE,
      asyncRetryerOptions: { maxAttempts: 1 },
      onItemsChange: batcher => {
        if (!this.replacingLatest && !batcher.peekAllItems().length) this.clearAgeTimer();
      },
      onError, throwOnError: false,
    });
  }

  add(item: T): void {
    if (this.closed) return;
    if (this.options.latestOnly) {
      if (this.executions.size) {
        this.latest = item;
        this.hasLatest = true;
        return;
      }
      // Replacing a cumulative projection must retain the first item's age cap.
      this.replacingLatest = true;
      try { this.batcher.clear(); }
      finally { this.replacingLatest = false; }
    }
    if (this.ageTimer === null) this.ageTimer = setTimeout(() => {
      this.ageTimer = null;
      this.track(this.batcher.flush());
    }, ACTIVITY_MAX_AGE_MS);
    // addItem also returns a quiet-period timer promise. Only actual batch
    // executions belong to shutdown's drain barrier.
    void this.batcher.addItem(item).catch(() => undefined);
  }

  async flush(): Promise<void> {
    this.clearAgeTimer();
    do {
      await this.batcher.flush();
      if (this.executions.size) await Promise.allSettled([...this.executions]);
    } while (this.executions.size || this.batcher.peekAllItems().length);
    await this.pending.catch(() => undefined);
  }

  /** Normal unmount drains accepted items before storage is closed. */
  async close(): Promise<void> {
    await this.flush();
    this.closed = true;
    this.batcher.cancel();
    this.batcher.clear();
  }

  /** Identity changes discard old-scope work rather than publish as a new user. */
  dispose(): void {
    this.closed = true;
    this.latest = undefined;
    this.hasLatest = false;
    this.clearAgeTimer();
    this.batcher.cancel();
    this.batcher.clear();
    this.batcher.abort();
    for (const retryer of this.retryers) retryer.abort();
    this.retryers.clear();
  }

  private track(work: Promise<unknown>): void {
    const handled = work.catch(() => undefined);
    this.executions.add(handled);
    void handled.then(() => {
      this.executions.delete(handled);
      if (!this.executions.size && this.hasLatest && !this.closed) {
        const latest = this.latest as T;
        this.latest = undefined;
        this.hasLatest = false;
        this.add(latest);
      }
    });
  }

  private clearAgeTimer(): void {
    if (this.ageTimer !== null) clearTimeout(this.ageTimer);
    this.ageTimer = null;
  }
}
