import { describe, expect, it, rs } from '@rstest/core';
import { draftSnapshotText, generateEmailBody, shareDraftSnapshot, type ComposerServices } from './composer-services';
import { recipientError } from './recipient-validation';

const draft = { draftKey: 'draft_1', subject: 'Launch', to: 'maya@example.com', cc: '', bodyText: 'Original draft' };
function services() {
  const receipts = new Map<string, unknown>();
  const sendMessage = rs.fn(async () => ({ messageId: 'message_1', clientMessageId: 'client_1' }));
  const send = rs.fn(async () => ({ text: 'Generated body', finishReason: 'stop' }));
  const check = rs.fn(async () => ({ allowed: true }));
  const value: ComposerServices = {
    workspaceId: 'workspace_1', conversationId: 'conversation_1',
    platform: {
      authorization: { check },
      inference: { listModels: async () => [], send },
      channels: { sendMessage },
      storage: {
        get: async ({ key }: { key: string }) => ({ value: receipts.get(key) ?? null, revision: null }),
        set: async ({ key, value }: { key: string; value: unknown }) => { receipts.set(key, value); },
      },
    } as never,
  };
  return { value, receipts, sendMessage, send, check };
}

describe('composer SDK actions', () => {
  it('shares an immutable snapshot once per destination and content, without Bcc or attachments', async () => {
    const { value, sendMessage, receipts } = services();
    const privateDraft = { ...draft, bcc: 'private@example.com', attachments: [{ fileName: 'secret.pdf' }] };
    expect(draftSnapshotText(privateDraft)).not.toContain('private@example.com');
    expect(draftSnapshotText(privateDraft)).not.toContain('secret.pdf');
    await shareDraftSnapshot(value, 'channel_1', privateDraft);
    await shareDraftSnapshot(value, 'channel_1', privateDraft);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace_1', channelId: 'channel_1', body: draftSnapshotText(draft) }));
    expect(JSON.stringify([...receipts.values()])).not.toContain(draft.bodyText);
    await shareDraftSnapshot(value, 'channel_1', { ...draft, bodyText: 'Revised' });
    await shareDraftSnapshot(value, 'channel_2', draft);
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });

  it('retries a lost response using the same host message identity', async () => {
    const { value, sendMessage } = services();
    sendMessage.mockRejectedValueOnce(new Error('Lost response'));
    await expect(shareDraftSnapshot(value, 'channel_1', draft)).rejects.toThrow('Lost response');
    await shareDraftSnapshot(value, 'channel_1', draft);
    expect(sendMessage.mock.calls[0]).toEqual(sendMessage.mock.calls[1]);
  });

  it('reports a delivered post even when saving its receipt fails', async () => {
    const { value, sendMessage } = services();
    let writes = 0;
    const storage = { ...value.platform.storage, set: async () => { if (++writes === 2) throw new Error('Offline'); } };
    const result = await shareDraftSnapshot({ ...value, platform: { ...value.platform, storage: storage as never } }, 'channel_1', draft);
    expect(result.warning).toContain('Shared successfully');
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('checks authorization before generation or channel posting', async () => {
    const { value, check, send, sendMessage } = services();
    check.mockResolvedValue({ allowed: false });
    await expect(generateEmailBody(value, 'model_1', 'Make it concise', draft)).rejects.toThrow('not permitted');
    await expect(shareDraftSnapshot(value, 'channel_1', draft)).rejects.toThrow('not permitted');
    expect(send).not.toHaveBeenCalled(); expect(sendMessage).not.toHaveBeenCalled();
  });

  it('uses only the active conversation and reviewable draft text for inference', async () => {
    const { value, send, sendMessage } = services();
    await expect(generateEmailBody(value, 'model_1', 'Make it concise', draft)).resolves.toBe('Generated body');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conversation_1', model: 'model_1',
      messages: [expect.objectContaining({ role: 'system' }), { role: 'user', content: JSON.stringify({ instructions: 'Make it concise', subject: 'Launch', currentBody: 'Original draft' }) }] }));
    expect(sendMessage).not.toHaveBeenCalled();
    await expect(generateEmailBody({ ...value, conversationId: null }, 'model_1', 'Write', draft)).rejects.toThrow('Select a TAP conversation');
    send.mockResolvedValue({ text: 'Partial', finishReason: 'length' });
    await expect(generateEmailBody(value, 'model_1', 'Write', draft)).rejects.toThrow('cut short');
  });
});

describe('shared recipient validation', () => {
  it('validates copied recipients and rejects newlines/partial addresses before both send paths', () => {
    expect(recipientError({ to: 'maya@example.com,pat@example.com', cc: '', bcc: '' })).toBeNull();
    for (const to of ['', 'maya', 'maya@example.com,', 'maya@example.com\nBcc: hidden@example.com']) {
      expect(recipientError({ to, cc: '', bcc: '' })).not.toBeNull();
    }
    expect(recipientError({ to: 'maya@example.com', cc: '', bcc: 'invalid' })).toContain('Bcc');
  });
});
