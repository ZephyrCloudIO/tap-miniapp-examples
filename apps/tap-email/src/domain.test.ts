import { describe, expect, it } from '@rstest/core';
import {
  composeMessage,
  cancelScheduledMessage,
  correctThreadAttention,
  emailThreadKey,
  isEmailMessage,
  isMailboxSnapshot,
  markDone,
  markThreadRead,
  mailSplitThreadCount,
  mergeMailboxSnapshot,
  moveSelection,
  normalizeMailPreferences,
  notificationsEnabledForAccount,
  previewMailState,
  remindThread,
  resolveReminderInput,
  saveMessageDraft,
  scheduleMessageDraft,
  selectAccount,
  selectSplit,
  selectedThread,
  toggleThreadRead,
  toggleStar,
  trashThread,
  undoLastAction,
  visibleThreads,
} from './domain';

const now = '2026-08-18T15:30:00.000Z';

describe('TAP Email domain', () => {
  it('accepts future provider accounts without changing account-scoped semantics', () => {
    const state = previewMailState();
    expect(isMailboxSnapshot({
      schemaVersion: 1,
      accounts: [{
        ...state.accounts[0]!,
        accountId: 'outlook_work',
        provider: 'microsoft',
        coverage: { ...state.accounts[0]!.coverage, accountId: 'outlook_work' },
      }],
      threads: [],
    })).toBe(true);
  });

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

  it('filters fixed categories from provider-neutral thread state', () => {
    const state = previewMailState();
    const starred = selectSplit(state, 'starred');
    expect(visibleThreads(starred).map(thread => thread.threadId)).toEqual([
      'gmail_thread_launch_review',
    ]);
    expect(mailSplitThreadCount(starred, 'starred')).toBe(1);
    expect(mailSplitThreadCount(selectAccount(starred, 'google_personal'), 'starred')).toBe(0);

    const done = selectSplit(markDone(state, 'cmd_done_category', now), 'done');
    expect(visibleThreads(done).map(thread => thread.threadId)).toContain(
      'gmail_thread_launch_review',
    );

    const reminded = selectSplit(remindThread(
      state,
      'cmd_remind_category',
      'reminder_category',
      '2026-08-19T12:00:00.000Z',
      'if_no_reply',
      now,
    ), 'reminders');
    expect(visibleThreads(reminded).map(thread => thread.threadId)).toContain(
      'gmail_thread_launch_review',
    );

    const trashedThread = { ...state.threads[0]!, status: 'trashed' as const };
    const trash = selectSplit({ ...state, threads: [trashedThread, ...state.threads.slice(1)] }, 'trash');
    expect(visibleThreads(trash)).toEqual([trashedThread]);
  });

  it('does not infer future fixed destinations from raw provider labels', () => {
    const state = previewMailState();
    const labeled = {
      ...state,
      threads: state.threads.map((thread, index) => index === 0
        ? { ...thread, labels: ['DRAFT', 'SENT', 'SPAM'] }
        : thread),
    };
    expect(visibleThreads(selectSplit(labeled, 'drafts'))).toEqual([]);
    expect(visibleThreads(selectSplit(labeled, 'sent'))).toEqual([]);
    expect(visibleThreads(selectSplit(labeled, 'spam'))).toEqual([]);
  });

  it('includes an ordered multi-message conversation for disclosure previewing', () => {
    const thread = previewMailState().threads[0];
    expect(thread?.messages).toHaveLength(3);
    expect(thread?.messages.map(message => message.messageId)).toEqual([
      'gmail_message_launch_review_1',
      'gmail_message_launch_review_2',
      'gmail_message_launch_review_3',
    ]);
    expect(thread?.messages.every((message, index, messages) =>
      index === 0 || Date.parse(messages[index - 1]!.sentAt) <= Date.parse(message.sentAt)
    )).toBe(true);
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

  it('marks an opened unread thread read and queues the account-scoped provider command', () => {
    const state = previewMailState();
    const current = selectedThread(state);
    expect(current?.unread).toBe(true);
    if (!current) return;

    const next = markThreadRead(
      state,
      current.accountId,
      current.threadId,
      'cmd_read_1',
      now,
    );

    expect(selectedThread(next)).toMatchObject({
      accountId: current.accountId,
      threadId: current.threadId,
      unread: false,
    });
    expect(next.commands.at(-1)).toMatchObject({
      commandId: 'cmd_read_1',
      accountId: current.accountId,
      threadId: current.threadId,
      kind: 'mark_read',
      expectedProviderRevision: current.providerRevision,
      payload: {},
    });
    expect(next.undo).toBe(state.undo);
  });

  it('does not queue another read command for a thread already marked read', () => {
    const state = previewMailState();
    const read = state.threads.find(thread => !thread.unread);
    expect(read).toBeTruthy();
    if (!read) return;

    expect(markThreadRead(
      state,
      read.accountId,
      read.threadId,
      'cmd_read_noop',
      now,
    )).toBe(state);
  });

  it('scopes read state by both account and thread ID', () => {
    const state = previewMailState();
    const work = state.threads.find(thread => thread.accountId === 'google_work' && thread.unread);
    const personal = state.threads.find(thread => thread.accountId === 'google_personal' && thread.unread);
    expect(work).toBeTruthy();
    expect(personal).toBeTruthy();
    if (!work || !personal) return;
    const collision = {
      ...state,
      threads: state.threads.map(thread =>
        emailThreadKey(thread) === emailThreadKey(personal)
          ? { ...thread, threadId: work.threadId }
          : thread,
      ),
    };

    const next = markThreadRead(
      collision,
      work.accountId,
      work.threadId,
      'cmd_read_scoped',
      now,
    );

    expect(next.threads.find(thread =>
      thread.accountId === work.accountId && thread.threadId === work.threadId
    )?.unread).toBe(false);
    expect(next.threads.find(thread =>
      thread.accountId === personal.accountId && thread.threadId === work.threadId
    )?.unread).toBe(true);
    expect(next.commands.at(-1)).toMatchObject({
      accountId: work.accountId,
      threadId: work.threadId,
      kind: 'mark_read',
    });
  });

  it('U toggles the selected thread between read and unread provider state', () => {
    const state = previewMailState();
    const current = selectedThread(state);
    expect(current?.unread).toBe(true);
    if (!current) return;

    const read = toggleThreadRead(state, 'cmd_toggle_read', now);
    expect(selectedThread(read)?.unread).toBe(false);
    expect(read.commands.at(-1)).toMatchObject({
      accountId: current.accountId,
      threadId: current.threadId,
      kind: 'mark_read',
    });

    const unread = toggleThreadRead(read, 'cmd_toggle_unread', now);
    expect(selectedThread(unread)?.unread).toBe(true);
    expect(unread.commands.at(-1)).toMatchObject({
      accountId: current.accountId,
      threadId: current.threadId,
      kind: 'mark_unread',
    });
  });

  it('# moves the selected thread to Trash and remains undoable before dispatch', () => {
    const state = previewMailState();
    const current = selectedThread(state);
    expect(current).toBeTruthy();
    if (!current) return;

    const trashed = trashThread(state, 'cmd_trash_1', now);
    expect(trashed.threads.find(thread =>
      emailThreadKey(thread) === emailThreadKey(current)
    )?.status).toBe('trashed');
    expect(trashed.commands.at(-1)).toMatchObject({
      commandId: 'cmd_trash_1',
      accountId: current.accountId,
      threadId: current.threadId,
      kind: 'trash',
    });
    const restored = undoLastAction(trashed, '2026-08-18T15:30:04.000Z');
    expect(selectedThread(restored)).toMatchObject({
      accountId: current.accountId,
      threadId: current.threadId,
      status: current.status,
    });
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

  it('keeps provider resource membership in sync with optimistic actions', () => {
    const state = previewMailState();
    const current = selectedThread(state)!;
    const projected = {
      ...state,
      threads: state.threads.map(thread =>
        emailThreadKey(thread) === emailThreadKey(current)
          ? { ...thread, providerResources: ['inbox'] as const, starred: false }
          : thread,
      ),
    };

    const starred = toggleStar(projected, 'cmd_star_resource', now);
    expect(selectedThread(starred)?.providerResources).toEqual(['inbox', 'starred']);

    const unstarred = toggleStar(starred, 'cmd_unstar_resource', now);
    expect(selectedThread(unstarred)?.providerResources).toEqual(['inbox']);

    const done = markDone(projected, 'cmd_done_resource', now);
    expect(done.threads.find(thread => thread.threadId === current.threadId)?.providerResources)
      .toEqual([]);
    expect(visibleThreads(done)).not.toContainEqual(
      expect.objectContaining({ threadId: current.threadId }),
    );
  });

  it('parses the high-frequency reminder phrases deterministically', () => {
    const base = new Date(2026, 7, 18, 15, 30);
    const tomorrow = resolveReminderInput('tomorrow', base);
    const threeDays = resolveReminderInput('3 days', base);
    const oneMinute = resolveReminderInput('in one minute', base);
    const oneHour = resolveReminderInput('in an hour', base);
    const twoWeeks = resolveReminderInput('in 2 weeks', base);
    expect([tomorrow?.getFullYear(), tomorrow?.getMonth(), tomorrow?.getDate(), tomorrow?.getHours()])
      .toEqual([2026, 7, 19, 8]);
    expect([threeDays?.getFullYear(), threeDays?.getMonth(), threeDays?.getDate(), threeDays?.getHours()])
      .toEqual([2026, 7, 21, 8]);
    expect([oneMinute?.getHours(), oneMinute?.getMinutes(), oneMinute?.getSeconds()])
      .toEqual([15, 31, 0]);
    expect([oneHour?.getHours(), oneHour?.getMinutes(), oneHour?.getSeconds()])
      .toEqual([16, 30, 0]);
    expect([twoWeeks?.getFullYear(), twoWeeks?.getMonth(), twoWeeks?.getDate(), twoWeeks?.getHours()])
      .toEqual([2026, 8, 1, 8]);
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
        draftKey: 'draft_cmd_send_1',
        draftRevision: 1,
        to: 'maya@example.com',
        subject: 'Launch decision',
        bodyText: 'Ship it.',
      },
    });
  });

  it('holds send locally for Undo and converts it back to a provider draft', () => {
    const state = previewMailState();
    const queued = composeMessage(
      state,
      'cmd_send_undoable',
      'google_personal',
      null,
      'maya@example.com',
      'Launch decision',
      'Ship it.',
      null,
      now,
      {
        draftKey: 'draft_undoable',
        draftRevision: 3,
        sendAfter: '2026-08-18T15:30:05.000Z',
      },
    );
    expect(queued.undo).toMatchObject({
      kind: 'send',
      commandId: 'cmd_send_undoable',
      draftKey: 'draft_undoable',
    });
    expect(queued.commands.at(-1)).toMatchObject({
      kind: 'send_draft',
      payload: { sendAfter: '2026-08-18T15:30:05.000Z' },
    });

    const undone = undoLastAction(queued, '2026-08-18T15:30:03.000Z');
    expect(undone.undo).toBeNull();
    expect(undone.commands.at(-1)).toMatchObject({
      commandId: 'cmd_send_undoable',
      kind: 'save_draft',
      payload: {
        draftKey: 'draft_undoable',
        draftRevision: 3,
        to: 'maya@example.com',
        subject: 'Launch decision',
        bodyText: 'Ship it.',
      },
    });
    expect(undone.commands.at(-1)?.payload).not.toHaveProperty('sendAfter');
  });

  it('coalesces unsent autosave revisions for one provider-visible draft', () => {
    const state = previewMailState();
    const first = saveMessageDraft(
      state,
      'cmd_save_1',
      'google_personal',
      'gmail_thread_board_pack',
      {
        draftKey: 'draft_reply_1',
        draftRevision: 1,
        to: 'morgan@example.com',
        subject: 'Re: Board pack',
        bodyText: 'First pass',
      },
      now,
    );
    const second = saveMessageDraft(
      first,
      'cmd_save_2',
      'google_personal',
      'gmail_thread_board_pack',
      {
        draftKey: 'draft_reply_1',
        draftRevision: 2,
        to: 'morgan@example.com',
        subject: 'Re: Board pack',
        bodyText: 'Second pass',
      },
      now,
    );

    expect(second.commands.filter(command => command.kind === 'save_draft')).toEqual([
      expect.objectContaining({
        commandId: 'cmd_save_2',
        kind: 'save_draft',
        payload: expect.objectContaining({
          draftKey: 'draft_reply_1',
          draftRevision: 2,
          bodyText: 'Second pass',
        }),
      }),
    ]);

    const sent = composeMessage(
      second,
      'cmd_send_saved_draft',
      'google_personal',
      'gmail_thread_board_pack',
      'morgan@example.com',
      'Re: Board pack',
      'Second pass',
      null,
      now,
      { draftKey: 'draft_reply_1', draftRevision: 2 },
    );
    expect(sent.commands.filter(command => command.kind === 'save_draft')).toEqual([]);
    expect(sent.commands.at(-1)).toMatchObject({
      kind: 'send_draft',
      payload: { draftKey: 'draft_reply_1', draftRevision: 2 },
    });
  });

  it('schedules a saved provider draft and creates a distinct cancellation command', () => {
    const state = saveMessageDraft(
      previewMailState(),
      'cmd_save_before_schedule',
      'google_personal',
      'gmail_thread_board_pack',
      {
        draftKey: 'draft_schedule_1',
        draftRevision: 2,
        to: 'morgan@example.com',
        subject: 'Re: Board pack',
        bodyText: 'Tomorrow morning.',
      },
      now,
    );
    const scheduled = scheduleMessageDraft(
      state,
      'cmd_schedule_1',
      'google_personal',
      'gmail_thread_board_pack',
      {
        draftKey: 'draft_schedule_1',
        draftRevision: 2,
        to: 'morgan@example.com',
        subject: 'Re: Board pack',
        bodyText: 'Tomorrow morning.',
        scheduledFor: '2026-08-19T12:00:00.000Z',
        cancelIfReply: true,
      },
      now,
    );
    expect(scheduled.commands.map(command => command.kind)).not.toContain('save_draft');
    expect(scheduled.commands.at(-1)).toMatchObject({
      commandId: 'cmd_schedule_1',
      kind: 'schedule_send',
      payload: {
        scheduledFor: '2026-08-19T12:00:00.000Z',
        cancelIfReply: true,
      },
    });

    const cancelled = cancelScheduledMessage(
      scheduled,
      'cmd_cancel_schedule_1',
      'google_personal',
      'gmail_thread_board_pack',
      'cmd_schedule_1',
      now,
    );
    expect(cancelled.commands.at(-1)).toMatchObject({
      commandId: 'cmd_cancel_schedule_1',
      kind: 'cancel_scheduled_send',
      payload: { scheduledCommandId: 'cmd_schedule_1' },
    });
  });

  it('accepts bounded rich bodies without requiring them for plain messages', () => {
    const plain = previewMailState().threads[0]!.messages[0]!;
    expect(isEmailMessage(plain)).toBe(true);
    expect(isEmailMessage({ ...plain, bodyHtml: null })).toBe(true);
    expect(isEmailMessage({
      ...plain,
      bodyHtml: '<table><tbody><tr><td>Launch</td></tr></tbody></table>',
    })).toBe(true);
    expect(isEmailMessage({ ...plain, bodyHtml: 'x'.repeat(500_001) })).toBe(false);
  });

  it('accepts provider-neutral attachment metadata without embedding bytes', () => {
    const plain = previewMailState().threads[0]!.messages[0]!;
    const attachment = {
      resourceId: 'attachment_1',
      fileName: 'launch-brief.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 42_000,
      disposition: 'attachment' as const,
      contentId: null,
    };

    expect(isEmailMessage({ ...plain, attachments: [attachment] })).toBe(true);
    expect(isEmailMessage({
      ...plain,
      attachments: [attachment, { ...attachment }],
    })).toBe(false);
    expect(isEmailMessage({
      ...plain,
      attachments: [{ ...attachment, sizeBytes: -1 }],
    })).toBe(false);
    expect(isEmailMessage({
      ...plain,
      attachments: [{ ...attachment, bytes: 'not allowed' }],
    })).toBe(false);
  });

  it('retains hydrated messages when a mailbox summary only updates thread metadata', () => {
    const state = previewMailState();
    const hydrated = state.threads[0]!;
    const richMessage = hydrated.messages.at(-1)!;
    expect(hydrated.messages).toHaveLength(3);
    expect(richMessage.bodyHtml).toContain('<table');

    const summaryThread = {
      ...hydrated,
      snippet: 'Fresh summary metadata from sync.',
      unread: false,
      messages: [{ ...richMessage, bodyHtml: undefined }],
    };
    const merged = mergeMailboxSnapshot(state, {
      schemaVersion: 1,
      accounts: state.accounts,
      threads: state.threads.map(thread =>
        emailThreadKey(thread) === emailThreadKey(hydrated) ? summaryThread : thread,
      ),
    });
    const retained = merged.threads.find(thread =>
      emailThreadKey(thread) === emailThreadKey(hydrated)
    )!;

    expect(retained).toMatchObject({
      snippet: 'Fresh summary metadata from sync.',
      unread: false,
    });
    expect(retained.messages).toBe(hydrated.messages);
    expect(retained.messages).toHaveLength(3);
    expect(retained.messages.at(-1)).toBe(richMessage);
    expect(retained.messages.at(-1)?.bodyHtml).toBe(richMessage.bodyHtml);
    expect(merged.selectedThreadKey).toBe(state.selectedThreadKey);
  });

  it('preserves explicit TAP triage corrections across provider refreshes', () => {
    const state = previewMailState();
    const target = state.threads[0]!;
    const corrected = correctThreadAttention(
      state,
      target.accountId,
      target.threadId,
      { critical: false, responseState: 'waiting' },
      now,
    );
    const correctedTarget = corrected.threads[0]!;
    expect(correctedTarget).toMatchObject({
      critical: false,
      needsResponse: false,
      waitingOnOthers: true,
      attentionCorrection: {
        critical: false,
        responseState: 'waiting',
        correctedAt: now,
      },
    });

    const merged = mergeMailboxSnapshot(corrected, {
      schemaVersion: 1,
      accounts: state.accounts,
      threads: state.threads.map(thread => ({ ...thread })),
    });
    expect(merged.threads[0]).toMatchObject({
      critical: false,
      needsResponse: false,
      waitingOnOthers: true,
      attentionCorrection: {
        correctedAt: now,
      },
    });
  });

  it('accumulates field-specific triage corrections without claiming other choices', () => {
    const state = previewMailState();
    const target = state.threads[0]!;
    const criticalCorrection = correctThreadAttention(
      state,
      target.accountId,
      target.threadId,
      { critical: false },
      '2026-09-14T09:00:00.000Z',
    );
    const responseCorrection = correctThreadAttention(
      criticalCorrection,
      target.accountId,
      target.threadId,
      { responseState: 'waiting' },
      '2026-09-14T09:01:00.000Z',
    );

    expect(responseCorrection.threads[0]).toMatchObject({
      critical: false,
      needsResponse: false,
      waitingOnOthers: true,
      attentionCorrection: {
        critical: false,
        responseState: 'waiting',
        correctedAt: '2026-09-14T09:01:00.000Z',
      },
    });
  });

  it('appends a newly seen preview message without dropping hydrated rich messages', () => {
    const state = previewMailState();
    const hydrated = state.threads[0]!;
    const existingRichMessage = hydrated.messages.at(-1)!;
    const previewMessage = {
      ...existingRichMessage,
      messageId: 'gmail_message_launch_review_4',
      sentAt: '2026-08-18T15:29:00.000Z',
      bodyText: 'One more production note arrived during sync.',
      bodyHtml: undefined,
    };
    const merged = mergeMailboxSnapshot(state, {
      schemaVersion: 1,
      accounts: state.accounts,
      threads: state.threads.map(thread =>
        emailThreadKey(thread) === emailThreadKey(hydrated)
          ? {
              ...thread,
              providerRevision: 'history_google_work_1830',
              snippet: previewMessage.bodyText,
              receivedAt: previewMessage.sentAt,
              messages: [previewMessage],
            }
          : thread,
      ),
    });
    const updated = merged.threads.find(thread =>
      emailThreadKey(thread) === emailThreadKey(hydrated)
    )!;

    expect(updated.messages.map(message => message.messageId)).toEqual([
      'gmail_message_launch_review_1',
      'gmail_message_launch_review_2',
      'gmail_message_launch_review_3',
      'gmail_message_launch_review_4',
    ]);
    expect(updated.messages.slice(0, 3)).toEqual(hydrated.messages);
    expect(updated.messages[0]).toBe(hydrated.messages[0]);
    expect(updated.messages[1]).toBe(hydrated.messages[1]);
    expect(updated.messages[2]).toBe(existingRichMessage);
    expect(updated.messages[2]?.bodyHtml).toBe(existingRichMessage.bodyHtml);
    expect(updated.messages[3]).toBe(previewMessage);
    expect(merged.selectedThreadKey).toBe(state.selectedThreadKey);
  });

  it('preserves structural identity and selection for an unchanged cloned snapshot', () => {
    const state = previewMailState();
    const selected = state.threads[1]!;
    const selectedState = {
      ...state,
      selectedAccountId: selected.accountId,
      selectedThreadKey: emailThreadKey(selected),
    };
    const snapshot = structuredClone({
      schemaVersion: 1 as const,
      accounts: state.accounts,
      threads: state.threads,
    });
    const merged = mergeMailboxSnapshot(selectedState, snapshot);

    expect(merged).toBe(selectedState);
    expect(merged.accounts).toBe(state.accounts);
    expect(merged.threads).toBe(state.threads);
    expect(merged.threads[0]).toBe(state.threads[0]);
    expect(merged.threads[0]?.messages).toBe(state.threads[0]?.messages);
    expect(merged.selectedAccountId).toBe(selectedState.selectedAccountId);
    expect(merged.selectedThreadKey).toBe(selectedState.selectedThreadKey);
  });

  it('keeps the selected thread stable when a fresh snapshot changes inbox order', () => {
    const state = previewMailState();
    const selected = state.threads[1]!;
    const selectedState = {
      ...state,
      selectedAccountId: selected.accountId,
      selectedThreadKey: emailThreadKey(selected),
    };
    const merged = mergeMailboxSnapshot(selectedState, {
      schemaVersion: 1,
      accounts: state.accounts,
      threads: [...state.threads].reverse(),
    });

    expect(merged.selectedAccountId).toBe(selectedState.selectedAccountId);
    expect(merged.selectedThreadKey).toBe(selectedState.selectedThreadKey);
    expect(selectedThread(merged)).toMatchObject({
      accountId: selected.accountId,
      threadId: selected.threadId,
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

  it('migrates the former hard-coded image setting to proxied images with trackers off', () => {
    const state = previewMailState();
    const migrated = normalizeMailPreferences({
      ...state.preferences,
      imagePolicyVersion: undefined,
      imagesEnabled: false,
      trackingPixelsEnabled: false,
    });

    expect(migrated).toMatchObject({
      imagePolicyVersion: 1,
      imagesEnabled: true,
      trackingPixelsEnabled: false,
    });
    expect(normalizeMailPreferences({
      ...migrated,
      imagesEnabled: false,
    }).imagesEnabled).toBe(false);
  });
});
