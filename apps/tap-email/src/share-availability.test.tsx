/** @rstest-environment jsdom */
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from '@rstest/core';
import { ComposeDialog } from './compose-dialog';
import { ReplyComposer } from './reply-composer';
import { previewMailState } from './domain';
import { BookingLinksError, type BookingLinksClient, type PublishedBookingLink } from './booking-links';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const link: PublishedBookingLink = {
  profileId: 'profile', eventTypeId: 'event', title: 'Office hours', durationMinutes: 30,
  url: 'https://cal.with-tap.ai/alex/office-hours', revisionId: 'revision', generation: 1,
};
const client = (overrides: Partial<BookingLinksClient> = {}): BookingLinksClient => ({
  scopeKey: 'user/workspace', list: async () => [link], resolve: async () => link, ...overrides,
});
const initialText = 'Before PLACE after';
const noOperation = () => undefined;

function Harness({ mode, bookingLinks, onSend = noOperation }: {
  mode: 'compose' | 'reply'; bookingLinks?: BookingLinksClient; onSend?: () => void;
}) {
  const [body, setBody] = useState(initialText);
  return mode === 'compose' ? <ComposeDialog
    accounts={previewMailState().accounts} bookingLinks={bookingLinks}
    draftKey="booking-draft" initialAccountId="google_work" initialBodyText={initialText}
    initialSubject="Meeting" initialTo="maya@example.com"
    onAttach={async () => ({ attachments: [], cancelled: false, failures: [] })}
    onAutosave={noOperation} onClose={noOperation} onSchedule={onSend} onSend={onSend}
  /> : <ReplyComposer
    bookingLinks={bookingLinks} attachmentBusy={false} attachmentError="" attachments={[]}
    bcc="" bodyText={body} cc="" focusRequestId={1} onAddressChange={noOperation}
    onAttach={noOperation} onBodyTextChange={setBody} onClose={noOperation}
    onRemoveAttachment={noOperation} onPromptReply={noOperation} onSchedule={onSend}
    onSend={onSend} onTogglePlacement={noOperation} placement="inline"
    recipientLabel="Maya" to="maya@example.com"
  />;
}

const button = (text: string) => {
  const match = Array.from(document.body.querySelectorAll('button')).find(element => element.textContent?.includes(text));
  if (!match) throw new Error(`Missing button ${text}`);
  return match;
};
const click = async (text: string) => { await act(async () => button(text).click()); };
const textarea = () => document.body.querySelector<HTMLTextAreaElement>('textarea')!;

async function mounted(mode: 'compose' | 'reply', bookingLinks?: BookingLinksClient, onSend = noOperation) {
  const container = document.createElement('div');
  document.body.append(container);
  const root: Root = createRoot(container);
  const render = async (value?: BookingLinksClient) => {
    await act(async () => root.render(<Harness mode={mode} bookingLinks={value} onSend={onSend} />));
  };
  await render(bookingLinks);
  return { render, dispose: async () => { await act(async () => root.unmount()); container.remove(); } };
}

describe('Share availability', () => {
  it.each(['compose', 'reply'] as const)('revalidates and inserts at the saved cursor in %s without sending', async mode => {
    let sends = 0;
    const calls: string[] = [];
    const view = await mounted(mode, client({
      list: async () => { calls.push('list'); return [link]; },
      resolve: async selection => { expect(selection).toEqual(link); calls.push('resolve'); return link; },
    }), () => { sends += 1; });
    try {
      textarea().setSelectionRange(7, 12);
      await click('Share availability');
      expect(calls).toEqual(['list']);
      expect(document.activeElement).toBe(button('Cancel'));
      await click('Office hours');
      expect(calls).toEqual(['list', 'resolve']);
      expect(textarea().value).toBe(`Before ${link.url} after`);
      expect(textarea().selectionStart).toBe(7 + link.url.length);
      expect(textarea().selectionEnd).toBe(7 + link.url.length);
      expect(sends).toBe(0);
    } finally { await view.dispose(); }
  });

  it('rejects a stale page, refreshes, and leaves the draft intact', async () => {
    let lists = 0;
    const view = await mounted('compose', client({
      list: async () => { lists += 1; return lists === 1 ? [link] : []; },
      resolve: async () => { throw new BookingLinksError('stale'); },
    }));
    try {
      await click('Share availability');
      await click('Office hours');
      expect(document.body.textContent).toContain('no longer published');
      expect(textarea().value).toBe(initialText);
      await click('Refresh');
      expect(document.body.textContent).toContain('No published booking pages');
      expect(lists).toBe(2);
      await click('Cancel');
      expect(textarea().value).toBe(initialText);
    } finally { await view.dispose(); }
  });

  it.each(['unavailable', 'denied'] as const)('shows %s separately from no published pages', async code => {
    const view = await mounted('reply', client({ list: async () => { throw new BookingLinksError(code); } }));
    try {
      await click('Share availability');
      expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(new BookingLinksError(code).message);
      expect(document.body.textContent).not.toContain('No published booking pages');
      expect(textarea().value).toBe(initialText);
    } finally { await view.dispose(); }
  });

  it('handles an unavailable host in preview', async () => {
    const view = await mounted('reply');
    try {
      await click('Share availability');
      expect(document.body.textContent).toContain('Calendar booking links are unavailable');
    } finally { await view.dispose(); }
  });

  it.each(['cancel', 'scope-change'] as const)('ignores a late selection result after %s', async action => {
    let finish!: (value: PublishedBookingLink) => void;
    const pending = new Promise<PublishedBookingLink>(resolve => { finish = resolve; });
    const view = await mounted('reply', client({ resolve: () => pending }));
    try {
      textarea().setSelectionRange(7, 12);
      await click('Share availability');
      await click('Office hours');
      if (action === 'cancel') await click('Cancel');
      else await view.render(client({ scopeKey: 'other-user/other-workspace', list: async () => [] }));
      await act(async () => { finish(link); await pending; });
      expect(textarea().value).toBe(initialText);
      expect(document.body.textContent).not.toContain('Office hours');
    } finally { await view.dispose(); }
  });

  it('does not overwrite text edited while checking the selected page', async () => {
    let finish!: (value: PublishedBookingLink) => void;
    const pending = new Promise<PublishedBookingLink>(resolve => { finish = resolve; });
    const view = await mounted('reply', client({ resolve: () => pending }));
    try {
      await click('Share availability');
      await click('Office hours');
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea(), 'New draft text');
        textarea().dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => { finish(link); await pending; });
      expect(textarea().value).toBe('New draft text');
      expect(document.body.textContent).toContain('Your message changed');
    } finally { await view.dispose(); }
  });
});
