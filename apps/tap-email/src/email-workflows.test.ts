import { describe, expect, it, rs } from '@rstest/core';
import type { MailCommandReceipt } from '@tap-examples/tap-email-protocol';
import { previewMailState } from './domain';
import type { EmailActivityProjection } from './activity';
import {
  MailMergeDraftPersistenceError,
  MAXIMUM_MAIL_MERGE_RECIPIENTS,
  commandsForReviewedMailMerge,
  createEmailActivityWorkflowPayload,
  createMailMergePlan,
  createMailboxRollupPayload,
  emailWorkflowDefinitions,
  grantMailMergeReview,
  invokeSavedEmailWorkflow,
  MAILBOX_ROLLUP_RESOURCES,
  persistProviderVisibleMailMergeDrafts,
  workflowPhaseForHostStatus,
  type EmailWorkflowRunState,
} from './email-workflows';

const generatedAt = '2026-08-18T15:29:00.000Z';

function appliedReceipt(
  commandId: string,
  idempotencyKey: string,
  accountId = 'acct-main',
): MailCommandReceipt {
  return {
    commandId,
    idempotencyKey,
    accountId,
    state: 'applied',
    acceptedAt: '2026-09-14T12:00:00.000Z',
    providerAcknowledgedAt: '2026-09-14T12:00:01.000Z',
    errorCode: null,
  };
}

describe('mailbox workflow payloads', () => {
  it('binds rollups to exact accounts, resources, time, and coverage', () => {
    const state = previewMailState();
    const accountId = state.accounts[0]!.accountId;
    const payload = createMailboxRollupPayload(
      state,
      'daily-rollup',
      {
        accountIds: [accountId],
        resources: ['inbox'],
        startAt: '2026-08-18T00:00:00.000Z',
        endAtExclusive: generatedAt,
        timeZone: 'America/New_York',
      },
      generatedAt,
    );

    expect(payload.scope).toEqual({
      accountIds: [accountId],
      resources: ['inbox'],
      startAt: '2026-08-18T00:00:00.000Z',
      endAtExclusive: generatedAt,
      timeZone: 'America/New_York',
    });
    expect(payload.coverageReceipt.complete).toBe(true);
    expect(payload.coverageReceipt.accounts).toHaveLength(1);
    expect(payload.counts.total).toBeGreaterThan(0);
    expect(payload.items.every(item => item.accountId === accountId)).toBe(true);
    expect(JSON.stringify(payload.items)).not.toContain('bodyText');
    expect(JSON.stringify(payload.items)).not.toContain('bodyHtml');
  });

  it('fails coverage closed when backfill, observation, or sync state is incomplete', () => {
    const state = previewMailState();
    const account = state.accounts[0]!;
    const payload = createMailboxRollupPayload(
      {
        threads: state.threads,
        accounts: [{
          ...account,
          coverage: {
            ...account.coverage,
            state: 'backfilling',
            backfillCompleteThrough: '2026-08-18T12:00:00.000Z',
            unresolvedFailures: 1,
          },
        }],
      },
      'missed-mail-audit',
      {
        accountIds: [account.accountId],
        resources: ['inbox', 'done'],
        startAt: '2026-08-01T00:00:00.000Z',
        endAtExclusive: '2026-08-18T16:00:00.000Z',
        timeZone: 'UTC',
      },
      '2026-08-18T16:00:00.000Z',
    );

    expect(payload.coverageReceipt.complete).toBe(false);
    expect(payload.coverageReceipt.warnings.join(' ')).toContain('backfilling');
    expect(payload.coverageReceipt.warnings.join(' ')).toContain('not backfilled');
    expect(payload.coverageReceipt.warnings.join(' ')).toContain('unresolved sync failure');
    expect(payload.coverageReceipt.warnings.join(' ')).toContain('observed only through');
  });

  it('rejects every resource that cannot produce a mailbox coverage receipt', () => {
    const state = previewMailState();
    for (const resource of [
      'auto-archived',
      'scheduled',
      'outbox',
      'snippets',
      'provider-private-label',
    ]) {
      expect(() => createMailboxRollupPayload(
        state,
        'daily-rollup',
        {
          accountIds: [state.accounts[0]!.accountId],
          resources: [resource as never],
          startAt: '2026-08-18T00:00:00.000Z',
          endAtExclusive: generatedAt,
          timeZone: 'UTC',
        },
        generatedAt,
      )).toThrow('cannot produce mailbox coverage receipts');
    }
    expect(MAILBOX_ROLLUP_RESOURCES).not.toContain('auto-archived');
    expect(MAILBOX_ROLLUP_RESOURCES).not.toContain('scheduled');
    expect(MAILBOX_ROLLUP_RESOURCES).not.toContain('outbox');
    expect(MAILBOX_ROLLUP_RESOURCES).not.toContain('snippets');
  });
});

describe('saved email workflow execution', () => {
  it('shows accepted, running, and succeeded host states', async () => {
    const definition = emailWorkflowDefinitions[0];
    const states: EmailWorkflowRunState[] = [];
    let listener: ((event: { run: never; observedAt: number }) => void) | undefined;
    const unsubscribe = rs.fn();
    const platform = {
      workflows: {
        list: rs.fn(async () => ({
          workflows: [{
            id: 'tap-email.morning-brief',
            name: 'Morning Brief',
            type: 'tap-email.morning-brief',
            createdAt: 1,
            updatedAt: 1,
          }],
        })),
        invokeSaved: rs.fn(async () => ({
          success: true,
          status: 'accepted',
          message: 'Accepted',
          runId: 'run-1',
        })),
        subscribeRun: rs.fn(async (_options, next) => {
          listener = next as typeof listener;
          return unsubscribe;
        }),
      },
    };

    const dispose = await invokeSavedEmailWorkflow({
      platform: platform as never,
      workspaceId: 'workspace-1',
      definition,
      payload: { safe: true },
      onState: state => states.push(state),
    });
    expect(states.map(state => state.phase)).toEqual(['accepted']);

    listener?.({
      observedAt: 2,
      run: {
        runId: 'run-1',
        workflowId: 'tap-email.morning-brief',
        workspaceId: 'workspace-1',
        status: 'running',
        startedAt: 2,
        completedAt: null,
        result: null,
        failure: null,
        correlation: null,
      } as never,
    });
    listener?.({
      observedAt: 3,
      run: {
        runId: 'run-1',
        workflowId: 'tap-email.morning-brief',
        workspaceId: 'workspace-1',
        status: 'completed',
        startedAt: 2,
        completedAt: 3,
        result: { summary: 'Ready' },
        failure: null,
        correlation: null,
      } as never,
    });

    expect(states.map(state => state.phase)).toEqual([
      'accepted',
      'running',
      'succeeded',
    ]);
    expect(states.at(-1)?.result).toEqual({ summary: 'Ready' });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('fails honestly when the named saved workflow is absent', async () => {
    const states: EmailWorkflowRunState[] = [];
    await invokeSavedEmailWorkflow({
      platform: {
        workflows: {
          list: async () => ({ workflows: [] }),
          invokeSaved: rs.fn(),
        },
      } as never,
      workspaceId: 'workspace-1',
      definition: emailWorkflowDefinitions[2],
      payload: {},
      onState: state => states.push(state),
    });

    expect(states).toEqual([
      expect.objectContaining({
        phase: 'failed',
        message: expect.stringContaining('cannot create or schedule'),
      }),
    ]);
  });

  it('does not treat unknown host status vocabulary as success', () => {
    expect(workflowPhaseForHostStatus('host-new-state')).toBe('accepted');
    expect(workflowPhaseForHostStatus('in progress')).toBe('running');
    expect(workflowPhaseForHostStatus('completed')).toBe('succeeded');
    expect(workflowPhaseForHostStatus('cancelled')).toBe('failed');
  });

  it('preserves a known running state when later observation is unavailable', async () => {
    const states: EmailWorkflowRunState[] = [];
    await invokeSavedEmailWorkflow({
      platform: {
        workflows: {
          list: async () => ({ workflows: [{
            id: 'tap-email.eod-wrap',
            name: 'EOD Wrap',
            type: 'tap-email.eod-wrap',
            createdAt: 1,
            updatedAt: 1,
          }] }),
          invokeSaved: async () => ({
            success: true,
            status: 'running',
            message: 'Started',
            runId: 'run-eod-1',
          }),
        },
      } as never,
      workspaceId: 'workspace-1',
      definition: emailWorkflowDefinitions[1],
      payload: {},
      onState: state => states.push(state),
    });

    expect(states.at(-1)).toEqual(expect.objectContaining({
      phase: 'running',
      runId: 'run-eod-1',
      message: expect.stringContaining('does not expose further'),
    }));
  });

  it('does not relabel an accepted run as failed when observation setup fails', async () => {
    const states: EmailWorkflowRunState[] = [];
    await invokeSavedEmailWorkflow({
      platform: {
        workflows: {
          list: async () => ({ workflows: [{
            id: 'tap-email.morning-brief',
            name: 'Morning Brief',
            type: 'tap-email.morning-brief',
            createdAt: 1,
            updatedAt: 1,
          }] }),
          invokeSaved: async () => ({
            success: true,
            status: 'accepted',
            message: 'Accepted',
            runId: 'run-morning-1',
          }),
          subscribeRun: async () => {
            throw new Error('host observation unavailable');
          },
        },
      } as never,
      workspaceId: 'workspace-1',
      definition: emailWorkflowDefinitions[0],
      payload: {},
      onState: state => states.push(state),
    });

    expect(states.at(-1)).toEqual(expect.objectContaining({
      phase: 'accepted',
      runId: 'run-morning-1',
      message: expect.stringContaining('observation is unavailable'),
    }));
    expect(states.some(state => state.phase === 'failed')).toBe(false);
  });
});

describe('content-free activity workflow', () => {
  it('passes only the existing committed-action aggregate', () => {
    const projection: EmailActivityProjection = {
      schemaVersion: 1,
      generatedAt: '2026-09-14T12:00:00.000Z',
      entries: [{
        action: 'reply_sent',
        outcome: 'applied',
        occurredAt: '2026-09-14T11:00:00.000Z',
        timeSource: 'provider_acknowledged_at',
      }],
      coverage: {
        scope: 'installation',
        source: 'private-profile-sqlite',
        trackingStartedAt: '2026-09-01T00:00:00.000Z',
        retainedAfter: '2026-09-01T00:00:00.000Z',
        availableFrom: '2026-09-01T00:00:00.000Z',
        truncated: false,
        warnings: [],
      },
    };
    const payload = createEmailActivityWorkflowPayload(projection, {
      startAt: '2026-09-14T00:00:00.000Z',
      endAtExclusive: '2026-09-14T12:00:00.000Z',
      timeZone: 'UTC',
    });

    expect(payload.summary.counts.byAction.reply_sent.applied).toBe(1);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('subject');
    expect(serialized).not.toContain('recipient');
    expect(serialized).not.toContain('threadId');
    expect(serialized).not.toContain('occurredAt');
  });
});

describe('review-gated mail merge drafts', () => {
  it('creates an immutable personalized recipient plan and only save_draft commands', async () => {
    let id = 0;
    const plan = await createMailMergePlan({
      accountId: 'acct-main',
      recipients: [
        { name: 'Avery', email: 'avery@example.com' },
        { name: 'Blake', email: 'blake@example.com' },
      ],
      subjectTemplate: 'Hello {{name}}',
      bodyTemplate: 'Hi {{name}}, reply to {{email}}.',
      now: '2026-09-14T12:00:00.000Z',
      idFactory: () => `stable-${++id}`,
    });

    expect(plan.drafts.map(draft => draft.payload.subject)).toEqual([
      'Hello Avery',
      'Hello Blake',
    ]);
    expect(new Set(plan.drafts.map(draft => draft.idempotencyKey)).size).toBe(2);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.drafts[0]?.payload)).toBe(true);

    expect(() => commandsForReviewedMailMerge(plan, {
      schemaVersion: 1,
      grantId: 'grant-wrong',
      planId: plan.planId,
      planDigest: plan.digest,
      reviewedDraftDigests: [],
      grantedAt: '2026-09-14T12:01:00.000Z',
      expiresAt: '2026-09-14T12:31:00.000Z',
    }, '2026-09-14T12:02:00.000Z')).toThrow('every recipient-level draft');

    const grant = grantMailMergeReview(plan, {
      reviewedDraftDigests: plan.drafts.map(draft => draft.digest),
      grantedAt: '2026-09-14T12:01:00.000Z',
      grantId: 'review-1',
    });
    const commands = commandsForReviewedMailMerge(
      plan,
      grant,
      '2026-09-14T12:02:00.000Z',
    );
    expect(commands).toHaveLength(2);
    expect(commands.every(command => command.kind === 'save_draft')).toBe(true);
    expect(JSON.stringify(commands)).not.toContain('send_draft');
    expect(commands.map(command => command.idempotencyKey)).toEqual(
      plan.drafts.map(draft => draft.idempotencyKey),
    );
  });

  it('enforces recipient, placeholder, and review-grant bounds', async () => {
    const base = {
      accountId: 'acct-main',
      subjectTemplate: 'Hello',
      bodyTemplate: 'Hi {{name}}',
      now: '2026-09-14T12:00:00.000Z',
      idFactory: () => 'stable',
    };
    await expect(createMailMergePlan({
      ...base,
      recipients: Array.from(
        { length: MAXIMUM_MAIL_MERGE_RECIPIENTS + 1 },
        (_, index) => ({ name: `${index}`, email: `person${index}@example.com` }),
      ),
    })).rejects.toThrow(`${MAXIMUM_MAIL_MERGE_RECIPIENTS} recipients`);
    await expect(createMailMergePlan({
      ...base,
      recipients: [{ name: 'Avery', email: 'avery@example.com' }],
      bodyTemplate: 'Hi {{company}}',
    })).rejects.toThrow('Unsupported mail merge placeholder');
    await expect(createMailMergePlan({
      ...base,
      accountId: 'invalid account id',
      recipients: [{ name: 'Avery', email: 'avery@example.com' }],
    })).rejects.toThrow('valid, explicit From account');

    const plan = await createMailMergePlan({
      ...base,
      recipients: [{ name: 'Avery', email: 'avery@example.com' }],
    });
    expect(() => grantMailMergeReview(plan, {
      reviewedDraftDigests: [],
      grantedAt: '2026-09-14T12:01:00.000Z',
      grantId: 'review-1',
    })).toThrow('Review every recipient-level draft');
    const grant = grantMailMergeReview(plan, {
      reviewedDraftDigests: plan.drafts.map(draft => draft.digest),
      grantedAt: '2026-09-14T12:01:00.000Z',
      grantId: 'review-1',
    });
    expect(() => commandsForReviewedMailMerge(
      plan,
      grant,
      '2026-09-14T13:00:00.000Z',
    )).toThrow('expired');
  });

  it('persists drafts sequentially and stops on an uncertain provider outcome', async () => {
    const plan = await createMailMergePlan({
      accountId: 'acct-main',
      recipients: [
        { name: 'Avery', email: 'avery@example.com' },
        { name: 'Blake', email: 'blake@example.com' },
      ],
      subjectTemplate: 'Hello {{name}}',
      bodyTemplate: 'Hi {{name}}',
      now: '2026-09-14T12:00:00.000Z',
      idFactory: () => 'stable',
    });
    const grant = grantMailMergeReview(plan, {
      reviewedDraftDigests: plan.drafts.map(draft => draft.digest),
      grantedAt: '2026-09-14T12:01:00.000Z',
      grantId: 'review-1',
    });
    const commands = commandsForReviewedMailMerge(
      plan,
      grant,
      '2026-09-14T12:02:00.000Z',
    );
    const sequence: string[] = [];
    const submitCommand = rs.fn(async command => {
      sequence.push(`submit:${command.commandId}`);
      return {
        accepted: true as const,
        duplicate: false,
        receipt: {
          ...appliedReceipt(command.commandId, command.idempotencyKey),
          state: 'accepted' as const,
          providerAcknowledgedAt: null,
        },
      };
    });
    const getCommand = rs.fn(async commandId => {
      sequence.push(`receipt:${commandId}`);
      const command = commands.find(item => item.commandId === commandId)!;
      return commandId === commands[0]!.commandId
        ? appliedReceipt(commandId, command.idempotencyKey)
        : {
            ...appliedReceipt(commandId, command.idempotencyKey),
            state: 'uncertain' as const,
            providerAcknowledgedAt: null,
            errorCode: 'provider_outcome_unknown',
          };
    });

    await expect(persistProviderVisibleMailMergeDrafts({
      client: { submitCommand, getCommand },
      commands,
      wait: async () => undefined,
      maximumPollAttempts: 1,
    })).rejects.toEqual(expect.objectContaining({
      name: 'MailMergeDraftPersistenceError',
      receipts: expect.arrayContaining([
        expect.objectContaining({ state: 'applied' }),
        expect.objectContaining({ state: 'uncertain' }),
      ]),
    } satisfies Partial<MailMergeDraftPersistenceError>));
    expect(sequence).toEqual([
      `submit:${commands[0]!.commandId}`,
      `receipt:${commands[0]!.commandId}`,
      `submit:${commands[1]!.commandId}`,
      `receipt:${commands[1]!.commandId}`,
    ]);
    expect(submitCommand.mock.calls.every(([command]) => command.kind === 'save_draft')).toBe(true);
  });
});
