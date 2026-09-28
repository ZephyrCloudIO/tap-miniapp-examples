/** @rstest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, rs } from '@rstest/core';
import type { TapFederatedSurfaceMountContext } from '@theaiplatform/miniapp-sdk/surface';
import { TapEmailApp } from './app';
import { previewMailState } from './domain';
import * as localStore from './local-store';
import * as preferences from './storage';
import * as coordinator from './coordinator-client';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('cached mailbox startup', () => {
  it('renders saved mail without waiting for preferences or the network, and omits the mobile sync action', async () => {
    const seed = { ...previewMailState(), selectedThreadKey: null };
    const store = new localStore.PreviewFixtureMailStore();
    rs.spyOn(store, 'load').mockResolvedValue(seed);
    rs.spyOn(store, 'save').mockResolvedValue(undefined);
    const factory = rs.spyOn(localStore, 'createLocalMailStore').mockReturnValue(store);
    const loadPreferences = rs.spyOn(preferences, 'loadPreferences').mockImplementation(() => new Promise(() => {}));
    const getMailboxPage = rs.fn(() => new Promise<coordinator.MailboxPage>(() => {}));
    const clientFactory = rs.spyOn(coordinator, 'createCoordinatorClient').mockReturnValue({ getMailboxPage } as unknown as ReturnType<typeof coordinator.createCoordinatorClient>);
    const publish = rs.fn(async (_name: string, _payload?: unknown) => {});
    const context = {
      events: { publish, subscribe: () => () => {} },
      entropy: { randomUUID: () => crypto.randomUUID() },
      launches: { subscribe: () => () => {} },
      hostAuthority: { getSnapshot: () => true, subscribe: () => () => {} },
    } as unknown as TapFederatedSurfaceMountContext;
    const slot = Symbol.for('tap.internal.v1');
    Reflect.set(globalThis, slot, { storage: { get: async () => ({ value: null, revision: 0 }), set: async () => ({ revision: 1 }) }, navigation: {} });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<TapEmailApp nativeHeader surfaceContext={context} />));
      expect(container.querySelectorAll('.mail-row').length).toBeGreaterThan(0);
      expect(container.textContent).not.toContain('Opening TAP Email');
      expect(container.querySelector('.capability-banner')).toBeNull();
      expect(loadPreferences).not.toHaveBeenCalled();
      expect(getMailboxPage).toHaveBeenCalledTimes(1);
      const header = publish.mock.calls.find(call => call[0] === 'tap.mobile.header')?.[1] as { actions: { id: string }[] } | undefined;
      expect(header).toBeDefined();
      expect(header?.actions.map(action => action.id)).toContain('compose');
      expect(header?.actions.map(action => action.id)).not.toContain('sync');
      expect(header?.actions.map(action => action.id)).not.toContain('mail-download');
    } finally {
      await act(async () => root.unmount());
      factory.mockRestore(); loadPreferences.mockRestore(); clientFactory.mockRestore();
      Reflect.deleteProperty(globalThis, slot);
      container.remove();
    }
  });
});
