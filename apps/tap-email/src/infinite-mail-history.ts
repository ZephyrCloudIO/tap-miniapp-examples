import { emailThreadKey, type EmailThread } from './domain';
import type { MailWindow, MailWindowQuery } from './bounded-mail-replica';

/** SQLite still reads bounded batches; the UI owns one continuous list. */
export async function readMailHistory(
  query: (options: MailWindowQuery) => Promise<MailWindow>,
  options: MailWindowQuery,
  batches: number,
  progress: (threads: readonly EmailThread[]) => void,
  initialPages: readonly MailWindow[] = [],
): Promise<MailWindow & { readonly pages: readonly MailWindow[] }> {
  const pages = [...initialPages];
  const rows = new Map(initialPages.flatMap(page => page.threads.map(thread => [emailThreadKey(thread), thread] as const)));
  let after = initialPages.at(-1)?.next ?? null as MailWindowQuery['after'];
  const seen = new Set<string>();
  if (initialPages.length && !after) return { threads: [...rows.values()], next: null, pages };
  for (const page of initialPages) if (page.next) seen.add(JSON.stringify(page.next));
  for (let index = initialPages.length; index < batches; index++) {
    options.signal?.throwIfAborted();
    const previous = [...rows.values()];
    const result = await query({ ...options, after, onProgress: threads => {
      if (options.signal?.aborted) return;
      const partial = new Map(previous.map(thread => [emailThreadKey(thread), thread]));
      for (const thread of threads) partial.set(emailThreadKey(thread), thread);
      progress([...partial.values()]);
    } });
    options.signal?.throwIfAborted();
    pages.push(result);
    for (const thread of result.threads) rows.set(emailThreadKey(thread), thread);
    after = result.next;
    progress([...rows.values()]);
    if (!after) break;
    const key = JSON.stringify(after);
    if (seen.has(key)) throw new Error('Mail history did not advance. Retry loading history.');
    seen.add(key);
  }
  return { threads: [...rows.values()], next: after ?? null, pages };
}
