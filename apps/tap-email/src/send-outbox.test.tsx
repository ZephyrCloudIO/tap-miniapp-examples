/** @rstest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, rs } from '@rstest/core';
import type { TapFederatedSurfaceMountContext } from '@theaiplatform/miniapp-sdk/surface';
import { TapEmailApp } from './app';
import { previewMailState, type MailState } from './domain';
import * as localStore from './local-store';
import * as preferences from './storage';
import * as coordinator from './coordinator-client';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('send to Outbox', () => {
  it.each(['saving', 'storage-failed', 'mailbox-loading', 'transport-failed'] as const)('keeps a clicked reply visible with its full body while %s', async mode => {
    const seed = previewMailState();
    const store = new localStore.PreviewFixtureMailStore();
    rs.spyOn(store, 'load').mockResolvedValue(seed);
    let saved: MailState | undefined;
    const save = rs.spyOn(store, 'save').mockImplementation(async value => {
      if (mode === 'saving') await new Promise<void>(() => {});
      if (mode === 'storage-failed') throw new Error('Device storage is full');
      saved = value;
    });
    const factory = rs.spyOn(localStore, 'createLocalMailStore').mockReturnValue(store);
    const loadPreferences = rs.spyOn(preferences, 'loadPreferences').mockResolvedValue(seed.preferences);
    const clock = rs.spyOn(Date, 'now');
    const submitCommand = rs.fn(async () => {
      if (mode === 'transport-failed') throw new Error('Mail service unavailable');
      await new Promise(() => {});
    });
    const clientFactory = rs.spyOn(coordinator, 'createCoordinatorClient').mockReturnValue({
      getMailboxPage: () => new Promise<coordinator.MailboxPage>(() => {}),
      readSettings: async () => ({ revision: 0, value: {} }),
      writeSettings: async (snapshot: { value: unknown }) => ({ ...snapshot, revision: 1 }),
      submitCommand,
    } as unknown as ReturnType<typeof coordinator.createCoordinatorClient>);
    const context = {
      userId: 'user_1', workspaceId: 'workspace_1',
      events: { publish: async () => {}, subscribe: () => () => {} },
      entropy: { randomUUID: () => crypto.randomUUID() },
      launches: { subscribe: () => () => {} },
      hostAuthority: { getSnapshot: () => true, subscribe: () => () => {} },
    } as unknown as TapFederatedSurfaceMountContext;
    const slot = Symbol.for('tap.internal.v1');
    Reflect.set(globalThis, slot, {
      storage: { get: async () => ({ value: null, revision: 0 }), set: async () => ({ revision: 1 }) }, navigation: {},
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<TapEmailApp surfaceContext={context} />));
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Reply"]')!.click());
      const form = container.querySelector<HTMLFormElement>('.reply-composer')!;
      const textarea = form.querySelector('textarea')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Keep every word of this queued reply.');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      });
      clock.mockReturnValue(Date.now() + 6_000);
      await act(async () => [...form.querySelectorAll('button')].find(button => button.textContent === 'Send')!.click());
      expect(container.querySelector('.reply-composer')).toBeNull();
      expect(container.querySelectorAll('.thread-message.is-outgoing')).toHaveLength(1);
      expect(container.querySelector('.thread-message.is-outgoing')?.textContent).toContain('Keep every word of this queued reply.');
      expect(container.querySelector('.thread-message.is-outgoing')?.textContent).toContain('Sending…');
      expect(container.querySelector('.thread-message.is-outgoing.is-unread')).toBeNull();
      const outboxButton = container.querySelector<HTMLButtonElement>('button[aria-label="Outbox, 1 threads"]');
      expect(outboxButton).not.toBeNull();
      await act(async () => outboxButton!.click());
      expect(container.querySelector('.outbox-item')?.textContent).toContain('Keep every word of this queued reply.');
      await act(async () => new Promise(resolve => setTimeout(resolve, 350)));
      expect(save).toHaveBeenCalled();
      if (mode === 'transport-failed' || mode === 'mailbox-loading') expect(submitCommand).toHaveBeenCalledTimes(1);
      else expect(submitCommand).not.toHaveBeenCalled();
      const status = container.querySelector('.outbox-item')?.textContent;
      expect(status).toContain('Keep every word of this queued reply.');
      expect(status).toContain(mode === 'storage-failed' ? 'Waiting for device storage' : mode === 'mailbox-loading' ? 'Waiting for confirmation' : mode === 'transport-failed' ? 'Send delayed' : 'Saving message');
      expect(container.querySelector('.outbox-item button')).toBeNull();
      if (mode === 'mailbox-loading') {
        expect(saved?.commands.find(command => command.kind === 'send_draft')?.payload).toMatchObject({
          bodyText: 'Keep every word of this queued reply.',
          expectedContext: { userId: 'user_1', workspaceId: 'workspace_1' },
        });
      }
    } finally {
      await act(async () => root.unmount());
      factory.mockRestore(); loadPreferences.mockRestore(); clientFactory.mockRestore(); clock.mockRestore();
      Reflect.deleteProperty(globalThis, slot);
      container.remove();
    }
  });
});
