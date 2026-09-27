/** @rstest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from '@rstest/core';
import type { TapFederatedSurfaceMountContext } from '@theaiplatform/miniapp-sdk/surface';
import { useComposerServices } from './use-composer-services';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('follows live ownership changes and never falls back to a stale conversation or workspace', async () => {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  let owner: { workspaceId: string | null; conversationId: string | null } = { workspaceId: 'current', conversationId: 'conversation_1' };
  const listeners = new Set<() => void>();
  const context = { workspaceId: 'old_workspace', conversationId: 'old_conversation', owner: {
    getSnapshot: () => owner,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  } } as unknown as TapFederatedSurfaceMountContext;
  function Probe({ preview = false }: { preview?: boolean }) {
    const services = useComposerServices(context, preview);
    return <output>{JSON.stringify([services.workspaceId, services.conversationId])}</output>;
  }
  try {
    await act(async () => root.render(<Probe />));
    expect(container.textContent).toBe('["current","conversation_1"]');
    await act(async () => { owner = { workspaceId: 'next', conversationId: 'conversation_2' }; listeners.forEach(listener => listener()); });
    expect(container.textContent).toBe('["next","conversation_2"]');
    await act(async () => { owner = { workspaceId: null, conversationId: null }; listeners.forEach(listener => listener()); });
    expect(container.textContent).toBe('[null,null]');
    await act(async () => { owner = { workspaceId: 'next', conversationId: 'conversation_2' }; root.render(<Probe preview />); });
    expect(container.textContent).toBe('[null,null]');
  } finally { await act(async () => root.unmount()); container.remove(); }
  expect(listeners.size).toBe(0);
});
