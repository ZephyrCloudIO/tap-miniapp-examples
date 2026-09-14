/** @rstest-environment jsdom */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, rs } from '@rstest/core';
import type { MailCommand, MailDraftPayload } from '@tap-examples/tap-email-protocol';
import { previewMailState } from './domain';
import type { EmailActivityProjection } from './activity';
import {
  parseMailMergeRecipients,
  WorkflowCenter,
} from './workflow-center';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const projection: EmailActivityProjection = {
  schemaVersion: 1,
  generatedAt: '2026-08-18T15:29:00.000Z',
  entries: [],
  coverage: {
    scope: 'installation',
    source: 'private-profile-sqlite',
    trackingStartedAt: '2026-08-01T00:00:00.000Z',
    retainedAfter: '2026-08-01T00:00:00.000Z',
    availableFrom: '2026-08-01T00:00:00.000Z',
    truncated: false,
    warnings: [],
  },
};

function findSection(dialog: HTMLElement, title: string): HTMLElement {
  const heading = [...dialog.querySelectorAll('h3')]
    .find(item => item.textContent === title);
  if (!heading) throw new Error(`Missing ${title} section.`);
  return heading.closest<HTMLElement>('section')!;
}

function changeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLInputElement
    ? HTMLInputElement.prototype
    : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

async function waitForText(element: HTMLElement, expected: string): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!element.textContent?.includes(expected)) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for workflow text: ${expected}`);
    }
    await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  }
}

describe('WorkflowCenter', () => {
  it('parses bounded human-readable recipient lines', () => {
    expect(parseMailMergeRecipients([
      'Avery Rivera <avery@example.com>',
      'Blake Chen, blake@example.com',
      'casey@example.com',
    ].join('\n'))).toEqual([
      { name: 'Avery Rivera', email: 'avery@example.com' },
      { name: 'Blake Chen', email: 'blake@example.com' },
      { name: '', email: 'casey@example.com' },
    ]);
  });

  it('runs a saved rollup with an explicit scope and visible succeeded state', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const previewState = previewMailState();
    const mailState = {
      ...previewState,
      selectedAccountId: previewState.accounts[0]!.accountId,
    };
    const invokeSaved = rs.fn(async (_input: unknown) => ({
      success: true,
      status: 'completed',
      message: 'Daily report ready',
      runId: 'run-daily-1',
    }));
    try {
      await act(async () => {
        root.render(
          <WorkflowCenter
            idFactory={() => 'stable-id'}
            loadActivityProjection={async () => projection}
            mailState={mailState}
            onClose={() => undefined}
            persistMailMergeDrafts={async () => undefined}
            platform={{
              workflows: {
                list: async () => ({ workflows: [{
                  id: 'tap-email.daily-rollup',
                  name: 'Daily Rollup',
                  type: 'tap-email.daily-rollup',
                  createdAt: 1,
                  updatedAt: 1,
                }] }),
                invokeSaved,
              },
            } as never}
            workspaceId="workspace-1"
          />,
        );
      });
      const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog.textContent).toContain('Morning Brief');
      expect(dialog.textContent).toContain('Email Activity Summary');
      expect(dialog.textContent).toContain('Mail Merge');
      expect(dialog.textContent).toContain('do not have thread-history coverage receipts yet');
      const resourceSelect = [...dialog.querySelectorAll<HTMLSelectElement>('select')]
        .find(select => [...select.options].some(option => option.value === 'inbox'))!;
      expect([...resourceSelect.options].map(option => option.value)).not.toContain('auto-archived');
      expect([...resourceSelect.options].map(option => option.value)).not.toContain('scheduled');
      expect([...resourceSelect.options].map(option => option.value)).not.toContain('outbox');
      expect([...resourceSelect.options].map(option => option.value)).not.toContain('snippets');

      const daily = findSection(dialog, 'Daily Rollup');
      await act(async () => {
        daily.querySelector<HTMLButtonElement>('button')!.click();
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(invokeSaved).toHaveBeenCalledTimes(1);
      const invocation = invokeSaved.mock.calls[0]![0] as {
        payload: {
          scope: { accountIds: readonly string[]; resources: readonly string[] };
          coverageReceipt: { complete: boolean; accounts: readonly unknown[] };
        };
      };
      expect(invocation.payload.scope.accountIds).toEqual(
        [mailState.accounts[0]!.accountId],
      );
      expect(invocation.payload.scope.resources).toEqual(['inbox']);
      expect(invocation.payload.coverageReceipt.complete).toBe(true);
      expect(invocation.payload.coverageReceipt.accounts).toHaveLength(
        1,
      );
      expect(daily.textContent).toContain('Coverage complete');
      expect(daily.textContent).toContain('Available through');
      expect(daily.textContent).toContain('Succeeded');
      expect(daily.textContent).toContain('run-daily-1');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('falls back from an unsupported selected view instead of reporting a complete zero', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const previewState = previewMailState();
    const invokeSaved = rs.fn(async (_input: unknown) => ({
      success: true,
      status: 'completed',
      message: 'Daily report ready',
      runId: 'run-supported-resource-1',
    }));
    try {
      await act(async () => {
        root.render(
          <WorkflowCenter
            idFactory={() => 'stable-id'}
            loadActivityProjection={async () => projection}
            mailState={{ ...previewState, selectedSplit: 'outbox' }}
            onClose={() => undefined}
            persistMailMergeDrafts={async () => undefined}
            platform={{
              workflows: {
                list: async () => ({ workflows: [{
                  id: 'tap-email.daily-rollup',
                  name: 'Daily Rollup',
                  type: 'tap-email.daily-rollup',
                  createdAt: 1,
                  updatedAt: 1,
                }] }),
                invokeSaved,
              },
            } as never}
            workspaceId="workspace-1"
          />,
        );
      });
      const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
      const resourceSelect = [...dialog.querySelectorAll<HTMLSelectElement>('select')]
        .find(select => [...select.options].some(option => option.value === 'inbox'))!;
      expect(resourceSelect.value).toBe('inbox');
      expect([...resourceSelect.options].map(option => option.value)).not.toContain('outbox');

      const daily = findSection(dialog, 'Daily Rollup');
      await act(async () => {
        daily.querySelector<HTMLButtonElement>('button')!.click();
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      const invocation = invokeSaved.mock.calls[0]![0] as {
        payload: {
          scope: { resources: readonly string[] };
          coverageReceipt: { complete: boolean };
          counts: { total: number };
        };
      };
      expect(invocation.payload.scope.resources).toEqual(['inbox']);
      expect(invocation.payload.counts.total).toBeGreaterThan(0);
      expect({
        complete: invocation.payload.coverageReceipt.complete,
        total: invocation.payload.counts.total,
      }).not.toEqual({ complete: true, total: 0 });
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('renders a missing saved workflow as a failed run instead of faking completion', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <WorkflowCenter
            idFactory={() => 'stable-id'}
            loadActivityProjection={async () => projection}
            mailState={previewMailState()}
            onClose={() => undefined}
            persistMailMergeDrafts={async () => undefined}
            platform={{
              workflows: {
                list: async () => ({ workflows: [] }),
                invokeSaved: rs.fn(),
              },
            } as never}
            workspaceId="workspace-1"
          />,
        );
      });
      const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
      const morning = findSection(dialog, 'Morning Brief');
      await act(async () => {
        morning.querySelector<HTMLButtonElement>('button')!.click();
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(morning.textContent).toContain('Failed');
      expect(morning.textContent).toContain('cannot create or schedule');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('requires recipient-level preview and review before creating only provider drafts', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let resolvePersistence: (() => void) | null = null;
    const persisted = rs.fn((
      _commands: readonly MailCommand<MailDraftPayload>[],
    ) => new Promise<void>(resolve => { resolvePersistence = resolve; }));
    let sequence = 0;
    try {
      await act(async () => {
        root.render(
          <WorkflowCenter
            idFactory={() => `stable-${++sequence}`}
            loadActivityProjection={async () => projection}
            mailState={previewMailState()}
            onClose={() => undefined}
            persistMailMergeDrafts={persisted}
            platform={{ workflows: { list: rs.fn(), invokeSaved: rs.fn() } } as never}
            workspaceId="workspace-1"
          />,
        );
      });
      const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
      const merge = findSection(dialog, 'Mail Merge');
      const textareas = merge.querySelectorAll<HTMLTextAreaElement>('textarea');
      const fullBodyTail = 'FULL-BODY-REVIEW-TAIL';
      await act(async () => {
        const recipients = textareas[0]!;
        changeValue(recipients, 'Avery <avery@example.com>\nBlake <blake@example.com>');
        const subject = merge.querySelector<HTMLInputElement>(
          'input[placeholder="Hello {{name}}"]',
        )!;
        changeValue(subject, 'Hello {{name}}');
        const body = textareas[1]!;
        changeValue(
          body,
          `Hi {{name}}, this is for {{email}}.\n\n${'Review detail. '.repeat(20)}${fullBodyTail}`,
        );
      });
      const preview = [...merge.querySelectorAll<HTMLButtonElement>('button')]
        .find(button => button.textContent?.includes('Preview recipient drafts'))!;
      await act(async () => preview.click());
      await waitForText(merge, 'Review all 2 drafts');
      expect(merge.textContent).toContain('Review all 2 drafts');
      expect(merge.textContent).toContain('Hello Avery');
      expect(merge.textContent).toContain('Hello Blake');
      expect(merge.textContent).toContain(fullBodyTail);
      expect(merge.querySelectorAll('.mail-merge-preview-body')).toHaveLength(2);

      const create = [...merge.querySelectorAll<HTMLButtonElement>('button')]
        .find(button => button.textContent?.includes('Create provider drafts'))!;
      expect(create.disabled).toBe(true);
      const review = merge.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
      await act(async () => review.click());
      expect(create.disabled).toBe(false);
      await act(async () => {
        create.click();
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(persisted).toHaveBeenCalledTimes(1);
      const commands = persisted.mock.calls[0]?.[0];
      if (!commands) throw new Error('Expected reviewed provider draft commands.');
      expect(commands).toHaveLength(2);
      expect(commands.every(command => command.kind === 'save_draft')).toBe(true);
      expect(commands.every(command => command.payload.bodyText.includes(fullBodyTail))).toBe(true);
      expect(JSON.stringify(commands)).not.toContain('send_draft');
      expect(merge.textContent).toContain('Running');
      expect([...merge.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        'input, textarea, select',
      )].every(input => input.disabled)).toBe(true);

      await act(async () => {
        resolvePersistence?.();
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      expect(merge.textContent).toContain('Succeeded');
      expect(merge.textContent).toContain('Nothing was sent');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
