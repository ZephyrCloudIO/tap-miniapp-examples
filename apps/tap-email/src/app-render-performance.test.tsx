/** @rstest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, rs } from '@rstest/core';
import { TapEmailApp } from './app';
import * as localStore from './local-store';
import * as domain from './domain';
import * as dates from './thread-list-dates';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('warm keyboard navigation render work', () => {
  it('reuses summaries, sidebar counts, grouping and timestamps across ten j/k moves', async () => {
    const seed = domain.previewMailState();
    const threads = seed.threads.map(thread => ({ ...thread, unread: false, downloadedPage: {
      providerRevision: thread.providerRevision, nextCursor: null, complete: true,
      windowed: false, seenCursors: [],
    } }));
    const store = new localStore.PreviewFixtureMailStore();
    rs.spyOn(store, 'load').mockResolvedValue({ ...seed, threads, preferences: { ...seed.preferences, htmlEnabled: false } });
    const factory = rs.spyOn(localStore, 'createLocalMailStore').mockReturnValue(store);
    const summary = rs.spyOn(domain, 'mailboxSummary');
    const counts = rs.spyOn(domain, 'mailSplitThreadCount');
    const groups = rs.spyOn(dates, 'groupThreadsByDay');
    const timestamps = rs.spyOn(dates, 'threadListTimestamp');
    const comparisons = rs.spyOn(String.prototype, 'localeCompare');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const scroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = () => {};
    try {
      await act(async () => root.render(<TapEmailApp preview />));
      const app = container.querySelector<HTMLElement>('.tap-email')!;
      app.focus();
      const initial = container.querySelector('.mail-row.is-selected .mail-subject')?.textContent;
      [summary, counts, groups, timestamps, comparisons].forEach(spy => spy.mockClear());
      for (let index = 0; index < 10; index++) {
        await act(async () => app.dispatchEvent(new KeyboardEvent('keydown', {
          key: index % 2 ? 'k' : 'j', bubbles: true,
        })));
        const selected = container.querySelector('.mail-row.is-selected .mail-subject')?.textContent;
        if (index % 2) expect(selected).toBe(initial);
        else expect(selected).not.toBe(initial);
      }
      expect({ summary: summary.mock.calls.length, counts: counts.mock.calls.length,
        groups: groups.mock.calls.length, timestamps: timestamps.mock.calls.length })
        .toEqual({ summary: 0, counts: 0, groups: 0, timestamps: 0 });
      expect(comparisons).not.toHaveBeenCalled();
      // A real data change must still update counts and remove the archived row.
      const before = container.querySelectorAll('.mail-row').length;
      const nextAfterDone = container.querySelectorAll('.mail-row .mail-subject')[2]!.textContent;
      await act(async () => {
        app.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }));
        app.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
      });
      expect(container.querySelectorAll('.mail-row')).toHaveLength(before - 1);
      expect(container.querySelector('.mail-row.is-selected .mail-subject')?.textContent).toBe(nextAfterDone);
      expect(container.querySelector('.thread-page-controls')?.textContent).not.toContain('Loading conversation');
      expect(summary.mock.calls.length).toBeGreaterThan(0);
    } finally {
      await act(async () => root.unmount()); container.remove();
      Element.prototype.scrollIntoView = scroll;
      rs.restoreAllMocks();
    }
  });
});
