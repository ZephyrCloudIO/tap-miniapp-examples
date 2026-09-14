/** @rstest-environment jsdom */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from '@rstest/core';
import { previewMailState } from './domain';
import type {
  LocalDataWipeReceipt,
  LocalMailStore,
  LocalStorageInventory,
} from './local-store';
import { formatStorageBytes, StoragePrivacyPanel } from './storage-privacy-panel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const inventory: LocalStorageInventory = {
  schemaVersion: 1,
  generatedAt: '2026-09-14T10:00:00.000Z',
  capability: 'private-profile-sqlite',
  scope: 'private-profile',
  indexedAt: '2026-09-14T09:59:00.000Z',
  accounts: [{
    accountId: 'google_work',
    provider: 'google',
    state: 'current',
    observedAt: '2026-09-14T09:59:00.000Z',
    indexedThrough: '2025-01-01T00:00:00.000Z',
    unresolvedFailures: 0,
    resourceKinds: ['inbox'],
    counts: { threads: 2, messages: 3, attachmentMetadata: 1 },
  }],
  counts: {
    accounts: 1,
    threads: 2,
    messages: 3,
    participants: 4,
    resources: 2,
    labels: 2,
    attachmentMetadata: 1,
  },
  classes: [{
    class: 'raw-mail',
    measurement: 'logical',
    itemCount: 3,
    bytes: 2_048,
    note: null,
  }],
  quota: { usedBytes: 2_048, quotaBytes: 1_000_000, hostLimitBytes: null, effectiveBytes: 1_000_000 },
  warnings: ['Semantic vectors report separately.'],
};

const wipeReceipt: LocalDataWipeReceipt = {
  schemaVersion: 1,
  scope: 'device',
  accountId: null,
  completedAt: '2026-09-14T10:01:00.000Z',
  complete: false,
  removedClasses: ['raw-mail'],
  overRemovedClasses: [],
  remainingClasses: ['semantic-vector', 'audit'],
  removed: {
    accounts: 1,
    threads: 2,
    messages: 3,
    attachmentMetadata: 1,
    cachedAttachmentBytes: 0,
    cachedRemoteImageBytes: 0,
  },
  warnings: ['Close the semantic index before claiming a complete wipe.'],
};

describe('StoragePrivacyPanel', () => {
  it('formats storage sizes compactly', () => {
    expect(formatStorageBytes(null)).toBe('Unavailable');
    expect(formatStorageBytes(500)).toBe('500 B');
    expect(formatStorageBytes(2_048)).toBe('2.0 KB');
  });

  it('shows measured classes and requires a second click before wiping', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let wipeCalls = 0;
    const receipts: LocalDataWipeReceipt[] = [];
    const store = {
      capability: 'private-profile-sqlite',
      inspectStorage: async () => inventory,
      wipeDevice: async () => {
        wipeCalls += 1;
        return wipeReceipt;
      },
    } as unknown as LocalMailStore;
    try {
      await act(async () => {
        root.render(
          <StoragePrivacyPanel
            accounts={previewMailState().accounts}
            onWipe={value => receipts.push(value)}
            store={store}
          />,
        );
      });
      await act(async () => Promise.resolve());
      expect(container.textContent).toContain('raw mail');
      expect(container.textContent).toContain('2.0 KB');
      expect(container.textContent).toContain('Semantic vectors report separately.');

      const button = [...container.querySelectorAll('button')].find(item =>
        item.textContent?.includes('Clear TAP Email data'))!;
      await act(async () => button.click());
      expect(wipeCalls).toBe(0);
      expect(button.textContent).toContain('Confirm');
      await act(async () => button.click());
      expect(wipeCalls).toBe(1);
      expect(receipts).toEqual([wipeReceipt]);
      expect(container.textContent).toContain('Partially cleared');
      expect(container.textContent).toContain('semantic-vector, audit');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
