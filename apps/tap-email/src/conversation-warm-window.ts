import { emailThreadKey, type EmailThread } from './domain';

export const conversationWarmRadius = 10;
export const conversationReaderKey = (thread: EmailThread) =>
  JSON.stringify([emailThreadKey(thread), thread.providerRevision]);

/** Cache keys include revisions; React identity lasts for the conversation. */
export const conversationReaderIdentity = (key: string): string => JSON.parse(key)[0];

/** Closest first on each side, with the direction of travel winning ties. */
export function conversationWarmWindow(rows: readonly EmailThread[], activeKey: string, direction: 1 | -1) {
  const index = rows.findIndex(thread => conversationReaderKey(thread) === activeKey);
  if (index < 0) return [];
  const neighbors: EmailThread[] = [];
  for (let distance = 1; distance <= conversationWarmRadius; distance++) {
    for (const offset of [direction * distance, -direction * distance]) {
      const thread = rows[index + offset];
      if (thread) neighbors.push(thread);
    }
  }
  return neighbors;
}

/** Reprioritize queued work without restarting useful overlapping downloads. */
export class ConversationWarmWindow {
  private targets: readonly EmailThread[] = [];
  private activeKey = '';
  private direction: 1 | -1 = 1;
  private readonly running = new Map<string, AbortController>();
  private readonly attempted = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private restoring = false;
  private readonly restored = new Set<string>();

  constructor(private readonly ready: (thread: EmailThread) => boolean,
    private readonly prepare: (thread: EmailThread, signal: AbortSignal) => Promise<boolean>,
    private readonly publish: (keys: readonly string[]) => void,
    private readonly concurrency = 2,
    private readonly restore?: (threads: readonly EmailThread[]) => Promise<unknown>) {}

  update(rows: readonly EmailThread[], activeKey: string): void {
    if (this.disposed) return;
    const previousIndex = rows.findIndex(thread => conversationReaderKey(thread) === this.activeKey);
    const nextIndex = rows.findIndex(thread => conversationReaderKey(thread) === activeKey);
    if (previousIndex >= 0 && nextIndex >= 0 && previousIndex !== nextIndex) {
      this.direction = nextIndex > previousIndex ? 1 : -1;
    }
    this.activeKey = activeKey;
    this.targets = conversationWarmWindow(rows, activeKey, this.direction);
    const wanted = new Set([activeKey, ...this.targets.map(conversationReaderKey)]);
    for (const [key, abort] of this.running) if (!wanted.has(key)) abort.abort();
    for (const key of this.attempted) if (!wanted.has(key)) this.attempted.delete(key);
    for (const key of this.restored) if (!wanted.has(key)) this.restored.delete(key);
    this.publishReady();
    this.restoreWindow();
    // Movement never resets this timer: rapid keys must not starve preparation.
    if (this.timer === null) this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, 48);
  }

  private restoreWindow(): void {
    if (this.disposed || this.restoring || !this.restore) return;
    const missing = this.targets.filter(thread => !this.ready(thread) && !this.restored.has(conversationReaderKey(thread)));
    if (!missing.length) return;
    for (const thread of missing) this.restored.add(conversationReaderKey(thread));
    this.restoring = true;
    void this.restore(missing).catch(() => undefined).finally(() => {
      this.restoring = false;
      this.publishReady();
      this.restoreWindow();
      this.pump();
    });
  }

  private publishReady(): void {
    if (this.disposed) return;
    // Bodies warm across the whole window; only four nearby DOM readers mount.
    this.publish(this.targets.filter(this.ready).slice(0, 4).map(conversationReaderKey));
  }

  private pump(): void {
    if (this.disposed) return;
    for (const thread of this.targets) {
      if (this.running.size >= this.concurrency) break;
      const key = conversationReaderKey(thread);
      if (this.ready(thread) || this.running.has(key) || this.attempted.has(key)) continue;
      const abort = new AbortController();
      this.running.set(key, abort);
      this.attempted.add(key);
      void this.prepare(thread, abort.signal).catch(() => false).finally(() => {
        this.running.delete(key);
        // Every completed neighbor is usable immediately, even if another stalls.
        this.publishReady();
        this.pump();
      });
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    for (const abort of this.running.values()) abort.abort();
    this.targets = [];
    this.attempted.clear();
    this.restored.clear();
  }
}
