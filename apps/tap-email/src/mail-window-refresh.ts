import { emailThreadKey, type MailState } from './domain';

/** Finish each read, then service at most one accumulated refresh request. */
export class MailWindowRefresh {
  private readonly abort = new AbortController();
  private running = false;
  private pending = false;

  constructor(private readonly read: (signal: AbortSignal) => Promise<void>,
    private readonly failed: (error: unknown) => void) {}

  refresh(): void {
    if (this.abort.signal.aborted) return;
    this.pending = true;
    if (!this.running) void this.drain();
  }

  dispose(): void { this.abort.abort(); }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.pending && !this.abort.signal.aborted) {
        this.pending = false;
        try { await this.read(this.abort.signal); }
        catch (error) { if (!this.abort.signal.aborted) this.failed(error); }
      }
    } finally { this.running = false; }
  }
}

/** Background history must not evict the account/page the reader selected. */
export function retainMailWindow(current: MailState, updated: MailState): MailState {
  const keys = new Set(current.threads.map(emailThreadKey));
  return { ...updated, threads: updated.threads.filter(thread => keys.has(emailThreadKey(thread))) };
}
