import type { EmailSemanticIndex } from './semantic-email-index';
import type { SemanticIndexQueue } from './semantic-index-queue';

export interface SemanticIndexProgress {
  readonly indexed: number;
  readonly pending: number;
}

/** One bounded unit. Flush vectors before acknowledging durable mail changes. */
export async function maintainSemanticIndexBatch(index: EmailSemanticIndex, queue: SemanticIndexQueue,
  signal: AbortSignal): Promise<SemanticIndexProgress> {
  signal.throwIfAborted();
  const batch = await queue.readSemanticBatch(index.collectionName, signal);
  signal.throwIfAborted();
  const deleted = batch.jobs.filter(job => !job.thread);
  if (deleted.length) await index.deleteThreads(deleted);
  const threads = batch.jobs.flatMap(job => job.thread ? [job.thread] : []);
  const stats = threads.length ? (await index.indexThreads(threads, signal)).stats : await index.stats();
  signal.throwIfAborted();
  await queue.acknowledgeSemanticBatch(index.collectionName, batch.jobs);
  // New changes may have arrived during embedding. The next pass re-reads the
  // queue; this count is explicitly progress for this observed batch only.
  return { indexed: stats.docCount, pending: Math.max(0, batch.pending - batch.jobs.length) };
}
