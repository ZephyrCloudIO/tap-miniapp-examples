import { emailThreadKey, type EmailThread, type MailState } from './domain';

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

/** Recent pages remain immediately readable while their disk refresh is queued. */
export class MailWindowCache {
  private readonly pages = new Map<string, { threads: readonly EmailThread[]; bytes: number }>();
  private bytes = 0;

  get(scope: string): readonly EmailThread[] | undefined {
    const page = this.pages.get(scope);
    if (!page) return undefined;
    this.pages.delete(scope);
    this.pages.set(scope, page);
    return page.threads;
  }

  set(scope: string, threads: readonly EmailThread[]): void {
    const previous = this.pages.get(scope);
    this.bytes -= previous?.bytes ?? 0;
    this.pages.delete(scope);
    // Keep object identities: a cached read must not become a new unsaved row,
    // or downgrade a hydrated body to its preview when the view is restored.
    const bytes = new TextEncoder().encode(JSON.stringify(threads)).byteLength;
    if (bytes <= 8 * 1024 * 1024) {
      this.pages.set(scope, { threads, bytes });
      this.bytes += bytes;
    }
    while (this.pages.size > 12 || this.bytes > 8 * 1024 * 1024) {
      const key = this.pages.keys().next().value!;
      this.bytes -= this.pages.get(key)!.bytes;
      this.pages.delete(key);
    }
  }

  clear(): void { this.pages.clear(); this.bytes = 0; }
}

/** Preserve newer in-memory actions and selected bodies while rows arrive. */
export function mergeMailWindow(current: MailState, incoming: readonly EmailThread[]): MailState {
  const existing = new Map(current.threads.map(thread => [emailThreadKey(thread), thread]));
  const threads = incoming.map(item => {
    const previous = existing.get(emailThreadKey(item));
    if (previous?.providerRevision !== item.providerRevision) return item;
    if ((previous as typeof item & { localReplicaRevision?: number }).localReplicaRevision ===
        (item as typeof item & { localReplicaRevision?: number }).localReplicaRevision) return previous;
    // A local commit can advance metadata while its list rows omit bodies.
    // The provider revision still owns the same conversation content.
    return { ...item, messages: previous.messages };
  });
  const selected = current.selectedThreadKey ? existing.get(current.selectedThreadKey) : undefined;
  if (selected && !threads.some(item => emailThreadKey(item) === current.selectedThreadKey)) threads.push(selected);
  return { ...current, threads };
}
