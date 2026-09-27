/** @rstest-environment jsdom */

import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from '@rstest/core';
import { RecipientInput } from './recipient-input';
import { completeRecipient, localSentRecipients, matchRecipients, recipientQuery, type RecipientSearch, type RecipientSuggestion } from './recipient-history';
import { previewMailState } from './domain';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const contacts: readonly RecipientSuggestion[] = [
  { name: 'Maya Chen', address: 'maya@example.com', lastSentAt: '2026-09-25T12:00:00Z' },
  { name: 'Maya Patel', address: 'patel@example.com', lastSentAt: '2026-09-26T12:00:00Z' },
];
let root: Root | undefined;
let container: HTMLDivElement;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
});

async function mount(initial = '', searchRecipients?: RecipientSearch, onKey = () => undefined) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  function Harness() {
    const [value, setValue] = useState(initial);
    return <form onKeyDown={onKey}>
      <RecipientInput id="to" label="To" name="to" value={value} onValueChange={setValue} contacts={contacts} searchRecipients={searchRecipients} />
    </form>;
  }
  await act(async () => root!.render(<Harness />));
  const input = container.querySelector('input')!;
  await act(async () => input.focus());
  return input;
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function key(input: HTMLInputElement, value: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
  await act(async () => { input.dispatchEvent(event); });
  return event;
}

describe('recipient history', () => {
  it('matches names and addresses, ranks prefixes, and excludes recipients across fields', () => {
    expect(matchRecipients([...contacts, contacts[0]!], 'mAyA', [])).toEqual(contacts);
    expect(matchRecipients(contacts, 'maya', ['MAYA@example.com'])).toEqual([contacts[1]]);
    expect(matchRecipients(contacts, 'example', [])).toEqual([contacts[1], contacts[0]]);
    expect(recipientQuery('first@example.com, ma')).toBe('ma');
    expect(completeRecipient('first@example.com, ma', 'maya@example.com')).toBe('first@example.com, maya@example.com');
  });

  it('uses outgoing messages only and ignores unsent drafts in the local fallback', () => {
    const state = previewMailState();
    const thread = state.threads[0]!;
    const account = state.accounts.find(item => item.accountId === thread.accountId)!;
    const message = thread.messages[0]!;
    const outgoing = { ...message, from: { name: 'Me', address: account.address }, to: [{ name: 'Prior recipient', address: 'prior@example.com' }] };
    const incoming = { ...message, from: { name: 'Stranger', address: 'stranger@example.com' }, to: [{ name: 'Me', address: account.address }] };
    const sent = { ...thread, labels: ['SENT'], messages: [outgoing, incoming] };
    expect(localSentRecipients(state.accounts, [sent])).toEqual([{
      name: 'Prior recipient', address: 'prior@example.com', lastSentAt: message.sentAt,
    }]);
    expect(localSentRecipients(state.accounts, [{ ...sent, labels: ['DRAFT'] }])).toEqual([]);
  });
});

describe('RecipientInput', () => {
  it('selects a name match with arrows and Enter without bubbling a send shortcut', async () => {
    let parentKeys = 0;
    const input = await mount('first@example.com, ma', undefined, () => { parentKeys++; });
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(2);
    await key(input, 'ArrowDown');
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain('Maya Patel');
    expect((await key(input, 'Enter')).defaultPrevented).toBe(true);
    expect(input.value).toBe('first@example.com,patel@example.com');
    expect(input.validity.valid).toBe(true);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(parentKeys).toBe(0);
  });

  it('supports Tab and mouse selection while preserving typed recipients', async () => {
    const input = await mount('ma');
    await key(input, 'Tab', { shiftKey: true });
    expect(input.value).toBe('ma');
    expect((await key(input, 'Tab')).defaultPrevented).toBe(false);
    expect(input.value).toBe('maya@example.com');
    await type(input, 'maya@example.com, pat');
    const option = container.querySelector<HTMLButtonElement>('[role="option"]')!;
    await act(async () => {
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      option.click();
    });
    expect(input.value).toBe('maya@example.com,patel@example.com');
    expect(document.activeElement).toBe(input);
  });

  it('dismisses suggestions, ignores IME Enter, and permits manual new addresses', async () => {
    const input = await mount('ma');
    await key(input, 'Enter', { isComposing: true });
    expect(input.value).toBe('ma');
    expect((await key(input, 'Escape')).defaultPrevented).toBe(true);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    await key(input, 'ArrowDown');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    await type(input, 'new@example.net');
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect((await key(input, 'Enter')).defaultPrevented).toBe(true);
    expect(input.value).toBe('new@example.net');
    expect(input.validity.valid).toBe(true);
  });

  it('debounces server searches and ignores out-of-order responses', async () => {
    const pending = new Map<string, (items: readonly RecipientSuggestion[]) => void>();
    const calls: string[] = [];
    const search: RecipientSearch = query => {
      calls.push(query);
      return new Promise(resolve => pending.set(query, resolve));
    };
    const input = await mount('', search);
    await type(input, 'm');
    await type(input, 'remote');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 210)); });
    expect(calls).toEqual(['remote']);
    await type(input, 'other');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 210)); });
    const other = { name: 'Other person', address: 'other@example.com', lastSentAt: contacts[0]!.lastSentAt };
    await act(async () => pending.get('other')!([other]));
    await act(async () => pending.get('remote')!([{ ...other, address: 'remote@example.com' }]));
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(container.querySelector('[role="option"]')?.textContent).toContain('other@example.com');
    await key(input, 'Enter');
    expect(input.value).toBe('other@example.com');
  });

  it('keeps local matches and manual entry available when history search fails', async () => {
    const input = await mount('ma', async () => { throw new Error('offline'); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 210)); });
    expect(container.querySelector('[role="status"]')?.textContent).toContain('unavailable');
    await key(input, 'Enter');
    expect(input.value).toBe('maya@example.com');
  });
});
