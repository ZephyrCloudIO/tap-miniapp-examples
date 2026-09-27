/** @rstest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from '@rstest/core';
import { EmailToolAccessPanel } from './email-tool-access-panel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Email tool connection', () => {
  it('recovers from a failed status request and preserves write scope on replacement', async () => {
    let attempts = 0;
    const created: boolean[] = [];
    const access = { connected: true, scopes: ['email.metadata.read', 'email.content.read', 'email.write'], expiresAt: '2026-10-24T00:00:00Z' };
    const client = {
      getEmailToolAccess: async () => {
        if (++attempts === 1) throw new Error('offline');
        return access;
      },
      createEmailToolAccess: async (allowWrites: boolean) => {
        created.push(allowWrites);
        return { ...access, token: 'replacement-token' };
      },
      revokeEmailToolAccess: async () => {},
    };
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () => root.render(<EmailToolAccessPanel client={client} senderContext={{ userId: 'user_1', workspaceId: 'workspace_1' }} />));
      const retry = [...container.querySelectorAll('button')].find(button => button.textContent === 'Retry loading tool access')!;
      await act(async () => retry.click());
      expect(container.querySelector('[role=alert]')).toBeNull();
      expect(container.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked).toBe(true);
      await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
      expect(created).toEqual([true]);
    } finally { await act(async () => root.unmount()); }
  });

  it('defaults to read scope, displays the token once, and revokes access', async () => {
    const created: boolean[] = [];
    let revoked = 0;
    const client = {
      getEmailToolAccess: async () => ({ connected: false, scopes: [], expiresAt: null }),
      createEmailToolAccess: async (allowWrites: boolean) => {
        created.push(allowWrites);
        return { token: 'private-token', connected: true, scopes: ['email.metadata.read'], expiresAt: '2026-10-24T00:00:00Z' };
      },
      revokeEmailToolAccess: async () => { revoked += 1; },
    };
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () => root.render(<EmailToolAccessPanel client={client} />));
      expect(container.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked).toBe(false);
      await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
      expect(created).toEqual([false]);
      expect(container.querySelector<HTMLInputElement>('input[type=password]')?.value).toBe('private-token');
      const revoke = [...container.querySelectorAll('button')].find(button => button.textContent === 'Revoke Email tool access')!;
      await act(async () => revoke.click());
      expect(revoked).toBe(1);
      expect(container.querySelector('input[type=password]')).toBeNull();
    } finally { await act(async () => root.unmount()); }
  });
});
