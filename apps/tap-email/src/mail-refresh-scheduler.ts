export const MAIL_REFRESH_INTERVAL_MS = 120_000;
const maximumRetryDelay = 600_000;

/** Quiet incremental refresh: no startup duplicate, hidden-tab polling, or focus bursts. */
export class MailRefreshScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private running = false;
  private failures = 0;
  private lastRefresh = Date.now();
  private retryAt = 0;

  constructor(private readonly refresh: () => Promise<void>, private readonly visible: () => boolean,
    initialDelay = MAIL_REFRESH_INTERVAL_MS) {
    this.schedule(initialDelay);
  }

  resume(): void {
    if (this.failures && Date.now() < this.retryAt) return;
    if (Date.now() - this.lastRefresh >= MAIL_REFRESH_INTERVAL_MS) void this.run();
  }

  dispose(): void { this.stopped = true; clearTimeout(this.timer); }

  private schedule(delay: number): void {
    clearTimeout(this.timer);
    this.retryAt = Date.now() + delay;
    if (!this.stopped) this.timer = setTimeout(() => { void this.run(); }, delay);
  }

  private async run(): Promise<void> {
    if (this.stopped || this.running) return;
    if (!this.visible()) { this.schedule(MAIL_REFRESH_INTERVAL_MS); return; }
    this.running = true;
    try {
      await this.refresh();
      this.lastRefresh = Date.now();
      this.failures = 0;
    } catch {
      this.failures++;
    } finally {
      this.running = false;
      this.schedule(this.failures ? Math.min(maximumRetryDelay, 5_000 * 2 ** (this.failures - 1)) : MAIL_REFRESH_INTERVAL_MS);
    }
  }
}
