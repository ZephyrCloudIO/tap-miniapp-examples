/** @rstest-environment jsdom */

import { describe, expect, it } from '@rstest/core';
import {
  accountIndexForCommand,
  isInteractiveTarget,
  isTextEntryTarget,
  listenForScopedDocumentKeyDown,
  resolveComposeShortcut,
  resolveShortcut,
  shouldEnterOpenReply,
  shouldEnterPromptReply,
} from './keybindings';

describe('TAP Email keybindings', () => {
  it('preserves the Superhuman triage loop', () => {
    expect(resolveShortcut({ key: 'j' }, null).command).toBe('next');
    expect(resolveShortcut({ key: 'K' }, null).command).toBe('previous');
    expect(resolveShortcut({ key: 'h' }, null).command).toBe('remind');
    expect(resolveShortcut({ key: 'e' }, null).command).toBe('done');
    expect(resolveShortcut({ key: 'r' }, null).command).toBe('reply');
    expect(resolveShortcut({ key: 'b' }, null).command).toBe('bring-to-conversation');
    expect(resolveShortcut({ key: 'z' }, null).command).toBe('undo');
  });

  it('maps H only to Remind Me', () => {
    const result = resolveShortcut({ key: 'h' }, null);
    expect(result).toEqual({
      command: 'remind',
      nextChord: null,
      preventDefault: true,
    });
  });

  it('maps unmodified Enter to reply', () => {
    expect(resolveShortcut({ key: 'Enter' }, null)).toEqual({
      command: 'reply',
      nextChord: null,
      preventDefault: true,
    });
  });

  it('maps command Enter to a distinct Chloe reply prompt', () => {
    expect(resolveShortcut({ key: 'Enter', metaKey: true }, null)).toEqual({
      command: 'prompt-reply',
      nextChord: null,
      preventDefault: true,
    });
    expect(resolveShortcut({ key: 'Enter', ctrlKey: true }, null).command).toBe('prompt-reply');
    expect(resolveShortcut({ key: 'Enter', metaKey: true, shiftKey: true }, null).command).toBeNull();
    expect(resolveShortcut({ key: 'Enter', ctrlKey: true, altKey: true }, null).command).toBeNull();
  });

  it('keeps compose-only shortcuts exact and local to the composer', () => {
    expect(resolveComposeShortcut({ key: 'Enter', metaKey: true })).toBe('send');
    expect(resolveComposeShortcut({ key: 'Enter', ctrlKey: true })).toBe('send');
    expect(resolveComposeShortcut({ key: 'Enter', metaKey: true, shiftKey: true })).toBeNull();
    expect(resolveComposeShortcut({ key: 'O', metaKey: true, shiftKey: true })).toBe('focus-to');
    expect(resolveComposeShortcut({ key: 'F', metaKey: true, shiftKey: true })).toBe('focus-from');
    expect(resolveComposeShortcut({ key: 'S', metaKey: true, shiftKey: true })).toBe('focus-subject');
    expect(resolveComposeShortcut({ key: 'M', metaKey: true, shiftKey: true })).toBe('focus-message');
    expect(resolveComposeShortcut({ key: ',', metaKey: true, shiftKey: true })).toBe('close-draft');
    expect(resolveComposeShortcut({ key: '<', metaKey: true, shiftKey: true })).toBe('close-draft');
    expect(resolveComposeShortcut({ key: 'O', metaKey: true })).toBeNull();
  });

  it('opens reply with Enter only for a selected thread outside interactive controls', () => {
    const message = document.createElement('article');
    const button = document.createElement('button');
    const buttonLabel = document.createElement('span');
    const input = document.createElement('input');
    button.append(buttonLabel);
    message.append(button, input);

    expect(shouldEnterOpenReply({ key: 'Enter' }, message, true)).toBe(true);
    expect(shouldEnterOpenReply({ key: 'Enter' }, message, false)).toBe(false);
    expect(shouldEnterOpenReply({ key: 'Enter', shiftKey: true }, message, true)).toBe(false);
    expect(isInteractiveTarget(buttonLabel)).toBe(true);
    expect(shouldEnterOpenReply({ key: 'Enter' }, buttonLabel, true)).toBe(false);
    expect(shouldEnterOpenReply({ key: 'Enter' }, input, true)).toBe(false);
  });

  it('opens the Chloe reply prompt only for command Enter on a selected thread', () => {
    const message = document.createElement('article');
    const button = document.createElement('button');
    message.append(button);

    expect(shouldEnterPromptReply({ key: 'Enter', metaKey: true }, message, true)).toBe(true);
    expect(shouldEnterPromptReply({ key: 'Enter', ctrlKey: true }, message, true)).toBe(true);
    expect(shouldEnterPromptReply({ key: 'Enter' }, message, true)).toBe(false);
    expect(shouldEnterPromptReply({ key: 'Enter', metaKey: true }, message, false)).toBe(false);
    expect(shouldEnterPromptReply({ key: 'Enter', metaKey: true, shiftKey: true }, message, true)).toBe(false);
    expect(shouldEnterPromptReply({ key: 'Enter', metaKey: true }, button, true)).toBe(false);
  });

  it('recognizes interactive targets from the rich-message iframe realm', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const frameDocument = frame.contentDocument!;
    const link = frameDocument.createElement('a');
    link.href = 'https://example.com';
    frameDocument.body.append(link);

    expect(isInteractiveTarget(link)).toBe(true);
    expect(shouldEnterOpenReply({ key: 'Enter' }, frameDocument.body, true)).toBe(true);
    expect(shouldEnterOpenReply({ key: 'Enter' }, link, true)).toBe(false);
    frame.remove();
  });

  it('supports unified navigation and scalable account shortcuts', () => {
    expect(resolveShortcut({ key: 'g' }, null).nextChord).toBe('g');
    expect(resolveShortcut({ key: 'a' }, 'g').command).toBe(
      'unified-account',
    );
    expect(resolveShortcut({ key: '1', ctrlKey: true }, null).command).toBe('account-1');
    expect(resolveShortcut({ key: '9', ctrlKey: true }, null).command).toBe('account-9');
    expect(accountIndexForCommand('account-1')).toBe(0);
    expect(accountIndexForCommand('account-9')).toBe(8);
    expect(accountIndexForCommand('inbox-split')).toBeNull();
    expect(resolveShortcut({ key: '1' }, 'g').command).toBeNull();
    expect(resolveShortcut({ key: 's' }, 'g').command).toBe('starred-split');
  });

  it('maps the supported folder chords from the reference sheet', () => {
    const expected = {
      i: 'inbox-split',
      s: 'starred-split',
      d: 'drafts-split',
      t: 'sent-split',
      e: 'done-split',
      h: 'reminders-split',
      ';': 'snippets-split',
      '!': 'spam-split',
      '#': 'trash-split',
    } as const;
    for (const [key, command] of Object.entries(expected)) {
      expect(resolveShortcut({ key }, 'g')).toEqual({
        command,
        nextChord: null,
        preventDefault: true,
      });
    }
    expect(resolveShortcut({ key: 'r' }, 'g').command).toBeNull();
  });

  it('maps read state and trash without treating shifted letters as plain commands', () => {
    expect(resolveShortcut({ key: 'u' }, null).command).toBe('toggle-read');
    expect(resolveShortcut({ key: '#', shiftKey: true }, null).command).toBe('trash');
    expect(resolveShortcut({ key: 'o' }, null).command).toBe('toggle-message-expansion');
    expect(resolveShortcut({ key: 'O', shiftKey: true }, null).command).toBe('expand-all-messages');
    expect(resolveShortcut({ key: 'S', shiftKey: true }, null).command).toBe('starred-split');
    for (const key of ['E', 'J', 'K', 'R', 'C', 'H', 'U']) {
      expect(resolveShortcut({ key, shiftKey: true }, null)).toEqual({
        command: null,
        nextChord: null,
        preventDefault: false,
      });
    }
    expect(resolveShortcut({ key: 'K', metaKey: true, shiftKey: true }, null).command).toBeNull();
    expect(resolveShortcut({ key: '?', shiftKey: true }, null).command).toBe('show-shortcuts');
  });

  it('recognizes nested editable and ARIA entry targets across realms', () => {
    const editable = document.createElement('div');
    const child = document.createElement('span');
    editable.setAttribute('contenteditable', 'true');
    editable.append(child);
    document.body.append(editable);
    expect(isTextEntryTarget(child)).toBe(true);

    const searchbox = document.createElement('div');
    const searchChild = document.createElement('span');
    searchbox.setAttribute('role', 'searchbox');
    searchbox.append(searchChild);
    document.body.append(searchbox);
    expect(isTextEntryTarget(searchChild)).toBe(true);

    const frame = document.createElement('iframe');
    document.body.append(frame);
    const frameEditable = frame.contentDocument!.createElement('div');
    const frameChild = frame.contentDocument!.createElement('span');
    frameEditable.setAttribute('contenteditable', 'true');
    frameEditable.append(frameChild);
    frame.contentDocument!.body.append(frameEditable);
    expect(isTextEntryTarget(frameChild)).toBe(true);
    editable.remove();
    searchbox.remove();
    frame.remove();
  });

  it('does not claim unrelated modified keys', () => {
    expect(resolveShortcut({ key: 'b', metaKey: true }, null)).toMatchObject({
      command: null,
      preventDefault: false,
    });
  });

  it('listens once across the miniapp and document focus without claiming host siblings', () => {
    const root = document.createElement('div');
    const miniappButton = document.createElement('button');
    const hostButton = document.createElement('button');
    root.append(miniappButton);
    document.body.append(root, hostButton);
    const received: string[] = [];
    const stopListening = listenForScopedDocumentKeyDown(
      document,
      root,
      event => received.push(event.key),
    );

    miniappButton.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'H' }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'R' }));
    hostButton.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'B' }));
    expect(received).toEqual(['H', 'R']);

    stopListening();
    miniappButton.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'E' }));
    expect(received).toEqual(['H', 'R']);
    root.remove();
    hostButton.remove();
  });
});
