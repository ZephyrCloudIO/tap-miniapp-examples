import { afterEach, describe, expect, it, rs } from '@rstest/core';
import { previewMailState } from './domain';
import {
  buildChloeEmailPrompt,
  maximumChloeEmailPromptLength,
  createChloeEmailHandoff,
  chloeEmailFailureMessage,
  CHLOE_EMAIL_ACTIONS,
} from './chloe-email';

describe('Chloe email prompts', () => {
  const thread = previewMailState().threads[0]!;

  it('requests a reviewable reply without authorizing sending', () => {
    const prompt = buildChloeEmailPrompt(thread, 'draft-reply');

    expect(prompt).toContain('Chloe, draft a reply');
    expect(prompt).toContain('Return a reviewable draft only. Do not send');
    expect(prompt).toContain(`Subject: ${thread.subject}`);
    expect(prompt).toContain('From:');
    expect(prompt).not.toContain('My instructions for the reply:');
  });

  it('uses distinct, evidence-aware prompts for every Chloe action', () => {
    expect(buildChloeEmailPrompt(thread, 'summarize')).toContain('main point');
    expect(buildChloeEmailPrompt(thread, 'explain-importance')).toContain('evidence');
    expect(buildChloeEmailPrompt(thread, 'extract-commitments')).toContain('owner');
  });

  it('bounds selected mail context while preserving review-only instructions', () => {
    const oversized = {
      ...thread,
      messages: thread.messages.map((message) => ({
        ...message,
        bodyText: 'private email context '.repeat(2_000),
      })),
    };

    const prompt = buildChloeEmailPrompt(oversized, 'draft-reply');
    expect(prompt.length).toBeLessThanOrEqual(maximumChloeEmailPromptLength);
    expect(prompt).toContain('[Selected email context truncated]');
    expect(prompt).not.toContain('My instructions for the reply:');
  });

  it('omits quoted plain-text history when the current message can be isolated', () => {
    const withQuote = {
      ...thread,
      messages: [
        {
          ...thread.messages[0]!,
          bodyText:
            'Current answer\n\nOn Sep 12, 2026, Someone <person@example.com> wrote:\nOld quoted text',
        },
      ],
    };

    const prompt = buildChloeEmailPrompt(withQuote, 'summarize');
    expect(prompt).toContain('Current answer');
    expect(prompt).not.toContain('Old quoted text');
  });

  afterEach(() => {
    rs.useRealTimers();
  });

  for (const action of CHLOE_EMAIL_ACTIONS) {
    it(`submits ${action.intent} exactly once through the dedicated Chloe capability`, async () => {
      rs.useFakeTimers();
      const handoff = createChloeEmailHandoff();
      const progress: string[] = [];
      const chat = {
        sendTextToChat: rs.fn(),
        askChloe: rs.fn(async ({ requestId }: { requestId: string; text: string }) => ({
          requestId,
          status: 'queued' as const,
          retryable: false,
        })),
        getChloeRequest: rs.fn(async ({ requestId }: { requestId: string }) => ({
          requestId,
          status: 'dispatched' as const,
          messageId: 'message-a',
          turnId: 'turn-a',
          retryable: false,
        })),
        retryChloeRequest: rs.fn(),
      };
      const result = handoff(chat, 'workspace-a', thread, action.intent, (receipt) =>
        progress.push(receipt.status),
      );
      const repeated = handoff(chat, 'workspace-a', thread, action.intent, () => undefined);
      expect(repeated).toBe(result);
      await rs.advanceTimersByTimeAsync(500);
      await result;
      expect(chat.askChloe).toHaveBeenCalledTimes(1);
      expect(chat.askChloe.mock.calls[0]?.[0].text).toMatch(/do not send/iu);
      expect(chat.sendTextToChat).not.toHaveBeenCalled();
      expect(progress).toEqual(['queued', 'dispatched']);
    });
  }

  it('reuses the request id after an ambiguous submission timeout', async () => {
    const handoff = createChloeEmailHandoff();
    const askChloe = rs.fn(async ({ requestId }: { requestId: string; text: string }) => ({
      requestId,
      status: 'dispatched' as const,
      messageId: 'message-a',
      turnId: 'turn-a',
      retryable: false,
    }));
    askChloe.mockRejectedValueOnce(new Error('Timeout'));
    const chat = {
      sendTextToChat: rs.fn(),
      askChloe,
      getChloeRequest: rs.fn(),
      retryChloeRequest: rs.fn(),
    };
    await expect(
      handoff(chat, 'workspace-a', thread, 'summarize', () => undefined),
    ).rejects.toThrow('Timeout');
    await handoff(chat, 'workspace-a', thread, 'summarize', () => undefined);
    expect(askChloe.mock.calls[0]?.[0].requestId).toBe(askChloe.mock.calls[1]?.[0].requestId);
  });

  it('reports unsupported hosts and content-free actionable errors', async () => {
    await expect(
      createChloeEmailHandoff()(
        { sendTextToChat: rs.fn() },
        'workspace-a',
        thread,
        'summarize',
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: 'unsupported-host' });
    expect(
      chloeEmailFailureMessage(
        Object.assign(new Error('private body'), { code: 'authorization-denied' }),
      ),
    ).toContain('Allow Ask Chloe');
    expect(
      chloeEmailFailureMessage(Object.assign(new Error('private body'), { code: 'private body' })),
    ).not.toContain('private body');
  });
});
