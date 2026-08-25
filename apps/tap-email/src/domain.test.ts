import { describe, expect, it } from '@rstest/core';
import {
  composeMessage,
  emailThreadKey,
  markDone,
  moveSelection,
  notificationsEnabledForAccount,
  previewMailState,
  remindThread,
  resolveReminderInput,
  selectAccount,
  selectedThread,
  undoLastAction,
  visibleThreads,
} from './domain';

const now = '2026-08-18T15:30:00.000Z';

describe('TAP Email domain', () => {
  it('defaults to a unified inbox and supports an immediate account filter', () => {
    const state = previewMailState();
    expect(state.selectedAccountId).toBe('all');
    expect(visibleThreads(state)).toHaveLength(5);
    const personal = selectAccount(state, 'google_personal');
    expect(visibleThreads(personal)).toHaveLength(2);
    expect(
      visibleThreads(personal).every(
        thread => thread.accountId === 'google_personal',
      ),
    ).toBe(true);
  });

  it('moves with J/K semantics without changing mailbox state', () => {
    const state = previewMailState();
    const first = selectedThread(state)?.threadId;
    const next = moveSelection(state, 1);
    expect(selectedThread(next)?.threadId).not.toBe(first);
    expect(next.commands).toHaveLength(0);
    expect(selectedThread(moveSelection(next, -1))?.threadId).toBe(first);
  });

  it('keeps selection and actions account-scoped when provider thread IDs collide', () => {
    const state = previewMailState();
    const workThread = state.threads.find(thread => thread.accountId === 'google_work');
    const personalThread = state.threads.find(thread => thread.accountId === 'google_personal');
    expect(workThread).toBeTruthy();
    expect(personalThread).toBeTruthy();
    if (!workThread || !personalThread) return;
    const collision = {
      ...state,
      threads: state.threads.map(thread =>
        emailThreadKey(thread) === emailThreadKey(personalThread)
          ? { ...thread, threadId: workThread.threadId }
          : thread,
      ),
      selectedThreadKey: emailThreadKey(workThread),
    };
    const changed = markDone(collision, 'cmd_collision', now);
    expect(
      changed.threads.find(thread => emailThreadKey(thread) === emailThreadKey(workThread))?.status,
    ).toBe('done');
    expect(
      changed.threads.find(
        thread => thread.accountId === personalThread.accountId && thread.threadId === workThread.threadId,
      )?.status,
    ).toBe(personalThread.status);
  });

  it('E marks Done, queues an explicit account-scoped archive, and advances', () => {
    const state = previewMailState();
    const current = selectedThread(state);
    const next = markDone(state, 'cmd_done_1', now);
    expect(
      next.threads.find(thread => thread.threadId === current?.threadId)?.status,
    ).toBe('done');
    expect(next.commands[0]).toMatchObject({
      commandId: 'cmd_done_1',
      accountId: current?.accountId,
      threadId: current?.threadId,
      kind: 'archive',
    });
    expect(selectedThread(next)?.threadId).not.toBe(current?.threadId);
  });

  it('H creates a TAP reminder without queuing a Gmail archive', () => {
    const state = previewMailState();
    const current = selectedThread(state);
    const next = remindThread(
      state,
      'cmd_remind_1',
      'reminder_1',
      '2026-08-19T12:00:00.000Z',
      'if_no_reply',
      now,
    );
    expect(
      next.threads.find(thread => thread.threadId === current?.threadId),
    ).toMatchObject({
      status: 'reminded',
      reminder: { condition: 'if_no_reply' },
    });
    expect(next.commands.map(command => command.kind)).toEqual([
      'create_reminder',
    ]);
  });

  it('undo restores the thread and removes its unaccepted local command', () => {
    const state = previewMailState();
    const current = selectedThread(state);
    const changed = markDone(state, 'cmd_done_1', now);
    const restored = undoLastAction(changed, '2026-08-18T15:30:04.000Z');
    expect(selectedThread(restored)?.threadId).toBe(current?.threadId);
    expect(restored.commands).toHaveLength(0);
    expect(restored.undo).toBeNull();
  });

  it('parses the high-frequency reminder phrases deterministically', () => {
    const base = new Date(2026, 7, 18, 15, 30);
    const tomorrow = resolveReminderInput('tomorrow', base);
    const threeDays = resolveReminderInput('3 days', base);
    expect([tomorrow?.getFullYear(), tomorrow?.getMonth(), tomorrow?.getDate(), tomorrow?.getHours()])
      .toEqual([2026, 7, 19, 8]);
    expect([threeDays?.getFullYear(), threeDays?.getMonth(), threeDays?.getDate(), threeDays?.getHours()])
      .toEqual([2026, 7, 21, 8]);
    expect(resolveReminderInput('not a date', base)).toBeNull();
  });

  it('queues compose with an explicit From account and stable provider scope', () => {
    const state = previewMailState();
    const next = composeMessage(
      state,
      'cmd_send_1',
      'google_personal',
      null,
      'maya@example.com',
      'Launch decision',
      'Ship it.',
      null,
      now,
    );
    expect(next.commands.at(-1)).toMatchObject({
      commandId: 'cmd_send_1',
      accountId: 'google_personal',
      threadId: null,
      kind: 'send_draft',
      payload: {
        to: 'maya@example.com',
        subject: 'Launch decision',
        bodyText: 'Ship it.',
      },
    });
  });

  it('defaults notifications on for new accounts and preserves an explicit opt-out', () => {
    const state = previewMailState();
    expect(notificationsEnabledForAccount(
      { ...state.preferences, notificationsConfigured: false, notificationAccountIds: [] },
      'google_personal',
    )).toBe(true);
    expect(notificationsEnabledForAccount(
      { ...state.preferences, notificationsConfigured: true, notificationAccountIds: [] },
      'google_personal',
    )).toBe(false);
  });
});
