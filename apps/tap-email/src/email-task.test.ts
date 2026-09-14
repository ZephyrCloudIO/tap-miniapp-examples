import { describe, expect, it } from '@rstest/core';
import type {
  MiniAppActionReceipt,
  MiniAppTask,
  MiniAppTasksApi,
} from '@theaiplatform/miniapp-sdk/sdk';
import {
  createEmailTask,
  emailTaskIdempotencyKey,
  emailTaskMetadata,
  emailTaskTitle,
  type EmailTaskReceiptRecord,
  type EmailTaskSource,
} from './email-task';

const source: EmailTaskSource = {
  accountId: 'google_work',
  threadId: 'thread_42',
  subject: 'Approve the launch plan',
  sender: 'Ada Lovelace <ada@example.com>',
  receivedAt: '2026-09-14T13:00:00.000Z',
  backlink: '#account=google_work&split=inbox&threadAccount=google_work&thread=thread_42',
  critical: true,
  needsResponse: true,
  reminderDueAt: '2026-09-15T16:00:00.000Z',
};

function receipt(
  status: MiniAppActionReceipt['status'],
  result: MiniAppActionReceipt['result'] = { taskId: 'task_7' },
): MiniAppActionReceipt {
  return {
    receiptId: 'receipt_7',
    idempotencyKey: 'host-returned-key',
    action: 'tasks.create-with-receipt',
    status,
    workspaceId: 'workspace_1',
    actorUserId: 'user_1',
    createdAt: 1,
    result,
    error: status === 'failed' ? 'denied' : null,
  };
}

const task: MiniAppTask = {
  id: 'task_7',
  title: 'Follow up: Approve the launch plan',
  description: '',
  status: 'toDo',
  priority: 'urgent',
  assignees: [],
  workspaceId: 'workspace_1',
  channelIds: [],
  createdAt: 1,
  updatedAt: 2,
  dueDate: Date.parse(source.reminderDueAt!),
  archived: false,
};

describe('email to canonical TAP Task', () => {
  it('builds bounded metadata with exact source IDs and no message content', () => {
    const metadata = emailTaskMetadata(source);
    expect(metadata).toContain('Source account ID: google_work');
    expect(metadata).toContain('Source thread ID: thread_42');
    expect(metadata).toContain(`Backlink: ${source.backlink}`);
    expect(metadata).not.toContain('email body');
    expect(metadata.length).toBeLessThanOrEqual(2_048);
    expect(emailTaskTitle({ subject: 'x'.repeat(500) }).length).toBeLessThanOrEqual(160);
  });

  it('uses a stable bounded idempotency key for the exact account/thread tuple', async () => {
    const first = await emailTaskIdempotencyKey(source, 'workspace_1');
    const replay = await emailTaskIdempotencyKey(source, 'workspace_1');
    const differentThread = await emailTaskIdempotencyKey(
      { ...source, threadId: 'thread_43' },
      'workspace_1',
    );
    expect(first).toBe(replay);
    expect(first).not.toBe(differentThread);
    expect(first).toMatch(/^tap-email:task:v1:[a-f0-9]{64}$/u);
  });

  it('creates once with a receipt, then applies priority and reminder due date', async () => {
    const creates: unknown[] = [];
    const updates: unknown[] = [];
    const records: EmailTaskReceiptRecord[] = [];
    const outcome = await createEmailTask({
      platform: {
        tasks: {
          createWithReceipt: async (options: Parameters<MiniAppTasksApi['createWithReceipt']>[0]) => {
            creates.push(options);
            return { receipt: receipt('completed') };
          },
          update: async (options: Parameters<MiniAppTasksApi['update']>[0]) => {
            updates.push(options);
            return { task };
          },
        } as never,
      },
      workspaceId: 'workspace_1',
      source,
      destination: {
        projectId: 'project_1',
        channelIds: ['channel_1', 'channel_1'],
        assigneeUserIds: ['user_1'],
      },
      persistReceipt: async record => { records.push(record); },
      now: () => '2026-09-14T14:00:00.000Z',
    });

    expect(outcome.status).toBe('completed');
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({
      workspaceId: 'workspace_1',
      title: 'Follow up: Approve the launch plan',
      projectId: 'project_1',
      channelIds: ['channel_1'],
      assigneeUserIds: ['user_1'],
    });
    expect(updates).toEqual([{
      workspaceId: 'workspace_1',
      taskId: 'task_7',
      status: 'toDo',
      priority: 'urgent',
      dueDate: Date.parse(source.reminderDueAt!),
    }]);
    expect(records).toEqual([expect.objectContaining({
      accountId: 'google_work',
      threadId: 'thread_42',
      workspaceId: 'workspace_1',
      receiptStatus: 'completed',
      configurationStatus: 'applied',
      taskId: 'task_7',
    })]);
  });

  it('preserves pending receipt state without guessing a task ID or updating', async () => {
    let updateCalls = 0;
    const records: EmailTaskReceiptRecord[] = [];
    const outcome = await createEmailTask({
      platform: {
        tasks: {
          createWithReceipt: async () => ({ receipt: receipt('pending', null) }),
          update: async () => {
            updateCalls += 1;
            return { task };
          },
        } as never,
      },
      workspaceId: 'workspace_1',
      source,
      persistReceipt: async record => { records.push(record); },
    });
    expect(outcome).toMatchObject({ status: 'pending', task: null });
    expect(updateCalls).toBe(0);
    expect(records[0]).toMatchObject({
      receiptStatus: 'pending',
      configurationStatus: 'not-applicable',
      taskId: null,
    });
  });

  it('replays duplicate-suppressed receipts through deterministic configuration', async () => {
    let createKey = '';
    let updateCalls = 0;
    const outcome = await createEmailTask({
      platform: {
        tasks: {
          createWithReceipt: async (options: Parameters<MiniAppTasksApi['createWithReceipt']>[0]) => {
            createKey = options.idempotencyKey;
            return { receipt: receipt('duplicate-suppressed') };
          },
          update: async () => {
            updateCalls += 1;
            return { task };
          },
        } as never,
      },
      workspaceId: 'workspace_1',
      source,
      persistReceipt: async () => undefined,
    });
    expect(createKey).toBe(await emailTaskIdempotencyKey(source, 'workspace_1'));
    expect(outcome.status).toBe('duplicate-suppressed');
    expect(updateCalls).toBe(1);
  });

  it('rejects a mismatched backlink tuple before calling the Tasks API', async () => {
    let createCalls = 0;
    await expect(createEmailTask({
      platform: {
        tasks: {
          createWithReceipt: async () => {
            createCalls += 1;
            return { receipt: receipt('completed') };
          },
          update: async () => ({ task }),
        } as never,
      },
      workspaceId: 'workspace_1',
      source: {
        ...source,
        backlink: '#account=google_work&split=inbox&threadAccount=google_work&thread=thread_99',
      },
      persistReceipt: async () => undefined,
    })).rejects.toThrow('invalid email source locator');
    expect(createCalls).toBe(0);
  });

  it('reports receipt-cache failure without claiming the created task failed', async () => {
    await expect(createEmailTask({
      platform: {
        tasks: {
          createWithReceipt: async () => ({ receipt: receipt('completed') }),
          update: async () => ({ task }),
        } as never,
      },
      workspaceId: 'workspace_1',
      source,
      persistReceipt: async () => { throw new Error('storage unavailable'); },
    })).rejects.toMatchObject({
      name: 'EmailTaskReceiptPersistenceError',
      task: { id: 'task_7' },
    });
  });
});
