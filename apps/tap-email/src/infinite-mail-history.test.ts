import { describe, expect, it, rs } from '@rstest/core';
import { readMailHistory } from './infinite-mail-history';
import { previewMailState } from './domain';
import type { MailWindowQuery } from './bounded-mail-replica';

describe('continuous local mail history', () => {
  it('appends only the new bounded batch, preserving earlier rows without rereading them', async () => {
    const source = previewMailState().threads[0]!;
    const cursor = { accountId: source.accountId, threadId: source.threadId, receivedAt: source.receivedAt };
    const older = { ...source, threadId: 'older' };
    const query = rs.fn(async (_options: MailWindowQuery) => ({ threads: [source, older], next: null }));
    const result = await readMailHistory(query, {}, 2, () => {}, [{ threads: [source], next: cursor }]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0].after).toEqual(cursor);
    expect(result.threads).toEqual([source, older]);
    expect(result.next).toBeNull();
  });
  it('stops repeated cursors and never loops on a broken history response', async () => {
    const source = previewMailState().threads[0]!;
    const cursor = { accountId: source.accountId, threadId: source.threadId, receivedAt: source.receivedAt };
    const query = rs.fn(async () => ({ threads: [source], next: cursor }));
    await expect(readMailHistory(query, {}, 3, () => {})).rejects.toThrow('did not advance');
    expect(query).toHaveBeenCalledTimes(2);
  });
});
