import type { MiniAppPrivateSqlTransaction } from '@theaiplatform/miniapp-sdk/sdk';
import type { EmailThread } from './domain';
import { insertBoundedRows } from './bounded-sql';

export interface SemanticIndexJob {
  readonly accountId: string;
  readonly threadId: string;
  readonly token: string;
  readonly thread: EmailThread | null;
}

export interface SemanticIndexQueue {
  prepareSemanticIndex(collection: string): Promise<void>;
  readSemanticBatch(collection: string, signal?: AbortSignal): Promise<{ jobs: readonly SemanticIndexJob[]; pending: number }>;
  acknowledgeSemanticBatch(collection: string, jobs: readonly SemanticIndexJob[]): Promise<void>;
}

/** Co-committed with mail changes. A stale worker cannot acknowledge a newer edit. */
export async function queueSemanticChanges(tx: MiniAppPrivateSqlTransaction,
  threads: readonly Pick<EmailThread, 'accountId' | 'threadId'>[]): Promise<void> {
  await insertBoundedRows(tx, 'local_mail_semantic_changes', ['account_id', 'thread_id', 'token'],
    threads.map(thread => [thread.accountId, thread.threadId, crypto.randomUUID()]));
}
