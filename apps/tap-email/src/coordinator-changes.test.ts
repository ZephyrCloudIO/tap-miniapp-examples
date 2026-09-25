import { describe, expect, it } from '@rstest/core';
import { createCoordinatorClient, type CoordinatorTransport } from './coordinator-client';
import { previewMailState } from './domain';

const seed = previewMailState();
function response() {
  return {
    mailbox: { schemaVersion: 1, accounts: seed.accounts, threads: seed.threads.slice(0, 1) },
    pageInfo: { nextCursor: null, revision: 20 },
    changes: { nextRevision: 20, hasMore: false, deletedThreads: [{ accountId: 'google_work', threadId: 'deleted' }] },
  };
}
function transport(body: unknown, urls: string[] = []): CoordinatorTransport {
  return { request: input => {
    urls.push(input.url);
    return { finalUrl: input.url, status: 200, statusText: 'OK', headers: [],
      bodyText: JSON.stringify(body), bodyBase64: null, bodyKind: 'text', bodyTruncated: false,
      sizeBytes: 1000, elapsedMs: 1, contentType: 'application/json' };
  } };
}

describe('coordinator change protocol', () => {
  it('validates revisioned changes and requests the exact continuation', async () => {
    const urls: string[] = [];
    const result = await createCoordinatorClient(transport(response(), urls)).getMailboxChanges(10);
    expect(urls[0]).toMatch(/\/v1\/mailbox\/changes\?after=10$/u);
    expect(result).toMatchObject({ revision: 20, nextRevision: 20, hasMore: false,
      deletedThreads: [{ accountId: 'google_work', threadId: 'deleted' }] });
  });

  it('rejects missing, regressing, non-advancing and inconsistent revisions', async () => {
    const valid = response();
    const invalid = [
      { ...valid, pageInfo: { nextCursor: null } },
      { ...valid, pageInfo: { nextCursor: null, revision: -1 } },
      { ...valid, pageInfo: { nextCursor: 'unexpected', revision: 20 } },
      { ...valid, changes: { ...valid.changes, nextRevision: 9 } },
      { ...valid, changes: { ...valid.changes, nextRevision: 10, hasMore: true } },
      { ...valid, changes: { ...valid.changes, nextRevision: 21 } },
      { ...valid, changes: { ...valid.changes, nextRevision: 19 } },
      { ...valid, changes: { ...valid.changes, deletedThreads: [{ accountId: '', threadId: 'deleted' }] } },
      { ...valid, changes: { ...valid.changes, deletedThreads: seed.threads.slice(0, 1) } },
      { ...valid, changes: { ...valid.changes, deletedThreads: Array(101).fill(valid.changes.deletedThreads[0]) } },
    ];
    for (const body of invalid) {
      await expect(createCoordinatorClient(transport(body)).getMailboxChanges(10)).rejects.toMatchObject({ code: 'invalid_response' });
    }
  });
});
