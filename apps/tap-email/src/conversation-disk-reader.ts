import { emailThreadKey, type EmailThread } from './domain';
import type { LocalMailStore } from './local-store';

/** Foreground and warm Query reads share one bounded, coalesced SDK disk transport. */
export function createConversationDiskReader(store: Pick<LocalMailStore, 'loadThread' | 'loadThreads'>) {
  type Pending = { accountId: string; threadId: string; signal: AbortSignal;
    resolve: (value: EmailThread | null) => void; reject: (error: unknown) => void };
  const pending: Pending[] = [];
  let running = false;
  let scheduled = false;
  const pump = async () => {
    scheduled = false;
    if (running) return;
    const batch = pending.splice(0, 21).filter(item => {
      if (!item.signal.aborted) return true;
      item.reject(item.signal.reason); return false;
    });
    if (!batch.length) { schedule(); return; }
    running = true;
    const abort = new AbortController();
    const cancel = () => { if (batch.every(item => item.signal.aborted)) abort.abort(); };
    for (const item of batch) item.signal.addEventListener('abort', cancel);
    try {
      const threads = await store.loadThreads!(batch, abort.signal);
      for (const item of batch) {
        if (item.signal.aborted) item.reject(item.signal.reason);
        else item.resolve(threads.get(emailThreadKey(item)) ?? null);
      }
    } catch (error) { for (const item of batch) item.reject(error); }
    finally {
      for (const item of batch) item.signal.removeEventListener('abort', cancel);
      running = false; schedule();
    }
  };
  const schedule = () => {
    if (!pending.length || scheduled || running) return;
    scheduled = true; queueMicrotask(() => { void pump(); });
  };
  return (accountId: string, threadId: string, signal: AbortSignal): Promise<EmailThread | null> => {
    if (signal.aborted) return Promise.reject(signal.reason);
    if (!store.loadThreads) return store.loadThread?.(accountId, threadId, true, signal) ?? Promise.resolve(null);
    return new Promise((resolve, reject) => {
      pending.push({ accountId, threadId, signal, resolve, reject }); schedule();
    });
  };
}
