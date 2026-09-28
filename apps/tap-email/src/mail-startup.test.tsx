/** @rstest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, rs } from '@rstest/core';
import type { TapFederatedSurfaceMountContext } from '@theaiplatform/miniapp-sdk/surface';
import { TapEmailApp } from './app';
import { defaultPreferences, normalizeMailPreferences, previewMailState, type MailPreferences } from './domain';
import * as localStore from './local-store';
import * as preferences from './storage';
import * as coordinator from './coordinator-client';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('cached mailbox startup', () => {
  it.each(['anonymous', 'legacy', 'cached'] as const)('renders saved mail before preferences or network and migrates settings afterward (%s)', async source => {
    const authenticated = source !== 'anonymous';
    const seed = { ...previewMailState(), selectedThreadKey: null,
      ...(source === 'legacy' ? { preferences: normalizeMailPreferences(defaultPreferences) } : {}) };
    const store = new localStore.PreviewFixtureMailStore();
    rs.spyOn(store, 'load').mockResolvedValue(seed);
    rs.spyOn(store, 'save').mockResolvedValue(undefined);
    const factory = rs.spyOn(localStore, 'createLocalMailStore').mockReturnValue(store);
    let resolvePreferences!: (value: MailPreferences) => void;
    const loadPreferences = rs.spyOn(preferences, 'loadPreferences').mockImplementation(() => new Promise(resolve => { resolvePreferences = resolve; }));
    const getMailboxPage = rs.fn(() => new Promise<coordinator.MailboxPage>(() => {}));
    const readSettings = rs.fn(async () => ({ revision: 0, value: {} }));
    const writeSettings = rs.fn(async (snapshot: { value: unknown }) => ({ ...snapshot, revision: 1 }));
    const clientFactory = rs.spyOn(coordinator, 'createCoordinatorClient').mockReturnValue({ getMailboxPage, readSettings, writeSettings } as unknown as ReturnType<typeof coordinator.createCoordinatorClient>);
    const publish = rs.fn(async (_name: string, _payload?: unknown) => {});
    const context = {
      ...(authenticated ? { userId: 'user_1', workspaceId: 'workspace_1' } : {}),
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
      expect(loadPreferences).toHaveBeenCalledTimes(authenticated ? 1 : 0);
      expect(getMailboxPage).toHaveBeenCalledTimes(1);
      const header = publish.mock.calls.find(call => call[0] === 'tap.mobile.header')?.[1] as { actions: { id: string }[] } | undefined;
      expect(header).toBeDefined();
      expect(header?.actions.map(action => action.id)).toContain('compose');
      expect(header?.actions.map(action => action.id)).not.toContain('sync');
      expect(header?.actions.map(action => action.id)).not.toContain('mail-download');
      if (authenticated) {
        expect(writeSettings).not.toHaveBeenCalled();
        const legacy = { ...defaultPreferences, htmlEnabled: false };
        await act(async () => resolvePreferences(legacy));
        const migrated = source === 'legacy' ? legacy : normalizeMailPreferences(seed.preferences);
        expect(writeSettings).toHaveBeenCalledWith({ revision: 0, value: { preferences: JSON.parse(JSON.stringify(migrated)) } });
      }
    } finally {
      await act(async () => root.unmount());
      factory.mockRestore(); loadPreferences.mockRestore(); clientFactory.mockRestore();
      Reflect.deleteProperty(globalThis, slot);
      container.remove();
    }
  });
});
