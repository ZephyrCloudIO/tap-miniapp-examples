const accountKeyCommands = [
  'account-1',
  'account-2',
  'account-3',
  'account-4',
  'account-5',
  'account-6',
  'account-7',
  'account-8',
  'account-9',
] as const;

export type AccountKeyCommand = (typeof accountKeyCommands)[number];

export type EmailKeyCommand =
  | 'next'
  | 'previous'
  | 'remind'
  | 'done'
  | 'undo'
  | 'toggle-read'
  | 'trash'
  | 'toggle-message-expansion'
  | 'expand-all-messages'
  | 'compose'
  | 'reply'
  | 'prompt-reply'
  | 'search'
  | 'palette'
  | 'bring-to-conversation'
  | 'toggle-star'
  | 'show-shortcuts'
  | 'unified-account'
  | AccountKeyCommand
  | 'inbox-split'
  | 'starred-split'
  | 'drafts-split'
  | 'sent-split'
  | 'done-split'
  | 'snippets-split'
  | 'spam-split'
  | 'trash-split'
  | 'critical-split'
  | 'needs-response-split'
  | 'waiting-split'
  | 'reminders-split';

export interface KeyStroke {
  readonly key: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
}

export interface ShortcutResolution {
  readonly command: EmailKeyCommand | null;
  readonly nextChord: 'g' | null;
  readonly preventDefault: boolean;
}

export type ComposeKeyCommand =
  | 'send'
  | 'focus-to'
  | 'focus-from'
  | 'focus-subject'
  | 'focus-message'
  | 'close-draft';

export const COMPOSE_SHORTCUTS: readonly {
  readonly keys: string;
  readonly label: string;
}[] = [
  { keys: '⌘Enter', label: 'Send' },
  { keys: '⌘⇧O', label: 'Focus To' },
  { keys: '⌘⇧F', label: 'Focus From' },
  { keys: '⌘⇧S', label: 'Focus Subject' },
  { keys: '⌘⇧M', label: 'Focus message' },
  { keys: '⌘⇧,', label: 'Save and close draft' },
] as const;

export const REPLY_SHORTCUTS: readonly {
  readonly keys: string;
  readonly label: string;
}[] = [
  { keys: '⌘⇧P', label: 'Pop reply out / in' },
] as const;

export const SHORTCUTS: readonly {
  command: EmailKeyCommand;
  keys: string;
  label: string;
  group: 'Triage' | 'Read' | 'Write' | 'Navigate' | 'TAP';
  runnable?: boolean;
}[] = [
  { command: 'next', keys: 'J', label: 'Next thread', group: 'Triage' },
  { command: 'previous', keys: 'K', label: 'Previous thread', group: 'Triage' },
  { command: 'remind', keys: 'H', label: 'Remind me', group: 'Triage' },
  { command: 'done', keys: 'E', label: 'Mark done', group: 'Triage' },
  { command: 'undo', keys: 'Z', label: 'Undo', group: 'Triage' },
  { command: 'toggle-star', keys: 'S', label: 'Star / unstar', group: 'Triage' },
  { command: 'toggle-read', keys: 'U', label: 'Mark read / unread', group: 'Triage' },
  { command: 'trash', keys: '#', label: 'Move to trash', group: 'Triage' },
  { command: 'toggle-message-expansion', keys: 'O', label: 'Expand / collapse message', group: 'Read' },
  { command: 'expand-all-messages', keys: '⇧O', label: 'Expand all messages', group: 'Read' },
  { command: 'compose', keys: 'C', label: 'Compose', group: 'Write' },
  { command: 'reply', keys: 'Enter / R', label: 'Reply', group: 'Write' },
  {
    command: 'prompt-reply',
    keys: '⌘Enter',
    label: 'Prompt Chloe for reply',
    group: 'Write',
  },
  { command: 'search', keys: '/', label: 'Search mail', group: 'Navigate' },
  { command: 'palette', keys: '⌘K', label: 'Command palette', group: 'Navigate' },
  { command: 'unified-account', keys: 'G A', label: 'Unified inbox', group: 'Navigate' },
  { command: 'account-1', keys: '⌃1–9', label: 'Switch account', group: 'Navigate', runnable: false },
  { command: 'inbox-split', keys: 'G I', label: 'Inbox', group: 'Navigate' },
  { command: 'starred-split', keys: 'G S / ⇧S', label: 'Starred', group: 'Navigate' },
  { command: 'drafts-split', keys: 'G D', label: 'Drafts', group: 'Navigate' },
  { command: 'sent-split', keys: 'G T', label: 'Sent', group: 'Navigate' },
  { command: 'done-split', keys: 'G E', label: 'Done', group: 'Navigate' },
  { command: 'reminders-split', keys: 'G H', label: 'Reminders', group: 'Navigate' },
  { command: 'snippets-split', keys: 'G ;', label: 'Snippets', group: 'Navigate' },
  { command: 'spam-split', keys: 'G !', label: 'Spam', group: 'Navigate' },
  { command: 'trash-split', keys: 'G #', label: 'Trash', group: 'Navigate' },
  { command: 'critical-split', keys: 'G C', label: 'Critical', group: 'Navigate' },
  {
    command: 'needs-response-split',
    keys: 'G N',
    label: 'Needs response',
    group: 'Navigate',
  },
  { command: 'waiting-split', keys: 'G W', label: 'Waiting', group: 'Navigate' },
  {
    command: 'bring-to-conversation',
    keys: 'B',
    label: 'Bring to conversation',
    group: 'TAP',
  },
  { command: 'show-shortcuts', keys: '?', label: 'Keyboard shortcuts', group: 'TAP' },
] as const;

function eventTargetElement(target: EventTarget | null): Element | null {
  if (
    !target ||
    typeof target !== 'object' ||
    !('nodeType' in target) ||
    target.nodeType !== 1 ||
    !('closest' in target) ||
    typeof target.closest !== 'function'
  ) {
    return null;
  }
  return target as Element;
}

export function isTextEntryTarget(target: EventTarget | null): boolean {
  const element = eventTargetElement(target);
  if (!element) return false;
  return Boolean(element.closest([
    'input',
    'textarea',
    'select',
    '[contenteditable]:not([contenteditable="false"])',
    '[role="textbox"]',
    '[role="searchbox"]',
    '[role="combobox"]',
  ].join(',')));
}

export function isInteractiveTarget(target: EventTarget | null): boolean {
  const element = eventTargetElement(target);
  if (!element) return false;
  return Boolean(element.closest([
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    'summary',
    '[contenteditable]:not([contenteditable="false"])',
    '[role="button"]',
    '[role="checkbox"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="radio"]',
    '[role="searchbox"]',
    '[role="switch"]',
    '[role="tab"]',
    '[role="textbox"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',')));
}

export function shouldEnterOpenReply(
  stroke: KeyStroke,
  target: EventTarget | null,
  hasSelectedThread: boolean,
): boolean {
  return (
    hasSelectedThread &&
    stroke.key === 'Enter' &&
    !stroke.metaKey &&
    !stroke.ctrlKey &&
    !stroke.altKey &&
    !stroke.shiftKey &&
    !isInteractiveTarget(target)
  );
}

export function shouldEnterPromptReply(
  stroke: KeyStroke,
  target: EventTarget | null,
  hasSelectedThread: boolean,
): boolean {
  return (
    hasSelectedThread &&
    stroke.key === 'Enter' &&
    Boolean(stroke.metaKey || stroke.ctrlKey) &&
    !stroke.altKey &&
    !stroke.shiftKey &&
    !isInteractiveTarget(target)
  );
}

export function listenForScopedDocumentKeyDown(
  targetDocument: Document,
  root: HTMLElement,
  listener: (event: KeyboardEvent) => void,
): () => void {
  const handleKeyDown = (event: KeyboardEvent) => {
    const target = event.target;
    const targetsDocument = target === targetDocument ||
      target === targetDocument.body ||
      target === targetDocument.documentElement;
    const targetsMiniApp = target instanceof Node && root.contains(target);
    if (!targetsDocument && !targetsMiniApp) return;
    listener(event);
  };
  targetDocument.addEventListener('keydown', handleKeyDown);
  return () => targetDocument.removeEventListener('keydown', handleKeyDown);
}

export function resolveShortcut(
  stroke: KeyStroke,
  chord: 'g' | null,
): ShortcutResolution {
  const key = stroke.key.length === 1 ? stroke.key.toLowerCase() : stroke.key;
  const commandModifier = Boolean(stroke.metaKey || stroke.ctrlKey);
  if (
    stroke.ctrlKey &&
    !stroke.metaKey &&
    !stroke.altKey &&
    !stroke.shiftKey &&
    /^[1-9]$/u.test(key)
  ) {
    const command = accountKeyCommands[Number(key) - 1] ?? null;
    return { command, nextChord: null, preventDefault: Boolean(command) };
  }
  if (commandModifier && key === 'Enter' && !stroke.altKey && !stroke.shiftKey) {
    return { command: 'prompt-reply', nextChord: null, preventDefault: true };
  }
  if (commandModifier && key === 'k' && !stroke.altKey && !stroke.shiftKey) {
    return { command: 'palette', nextChord: null, preventDefault: true };
  }
  if (commandModifier || stroke.altKey) {
    return { command: null, nextChord: null, preventDefault: false };
  }
  if (chord === 'g') {
    if (stroke.shiftKey && /^[a-z]$/u.test(key)) {
      return { command: null, nextChord: null, preventDefault: false };
    }
    const commands: Readonly<Record<string, EmailKeyCommand>> = {
      a: 'unified-account',
      i: 'inbox-split',
      s: 'starred-split',
      d: 'drafts-split',
      t: 'sent-split',
      e: 'done-split',
      h: 'reminders-split',
      ';': 'snippets-split',
      '!': 'spam-split',
      '#': 'trash-split',
      c: 'critical-split',
      n: 'needs-response-split',
      w: 'waiting-split',
    };
    return {
      command: commands[key] ?? null,
      nextChord: null,
      preventDefault: Boolean(commands[key]),
    };
  }
  if (key === 'g' && !stroke.shiftKey) {
    return { command: null, nextChord: 'g', preventDefault: true };
  }
  if (stroke.shiftKey && key === 'o') {
    return { command: 'expand-all-messages', nextChord: null, preventDefault: true };
  }
  if (stroke.shiftKey && key === 's') {
    return { command: 'starred-split', nextChord: null, preventDefault: true };
  }
  // Shifted letters have their own meanings in the reference key map. Until
  // those product actions exist, do not silently execute the unshifted action.
  if (stroke.shiftKey && /^[a-z]$/u.test(key)) {
    return { command: null, nextChord: null, preventDefault: false };
  }
  const commands: Readonly<Record<string, EmailKeyCommand>> = {
    Enter: 'reply',
    j: 'next',
    k: 'previous',
    h: 'remind',
    e: 'done',
    z: 'undo',
    c: 'compose',
    r: 'reply',
    '/': 'search',
    b: 'bring-to-conversation',
    s: 'toggle-star',
    u: 'toggle-read',
    o: 'toggle-message-expansion',
    '#': 'trash',
    '?': 'show-shortcuts',
  };
  return {
    command: commands[key] ?? null,
    nextChord: null,
    preventDefault: Boolean(commands[key]),
  };
}

export function resolveComposeShortcut(stroke: KeyStroke): ComposeKeyCommand | null {
  const key = stroke.key.length === 1 ? stroke.key.toLowerCase() : stroke.key;
  const commandModifier = Boolean(stroke.metaKey || stroke.ctrlKey);
  if (!commandModifier || stroke.altKey) return null;
  if (key === 'Enter' && !stroke.shiftKey) return 'send';
  if (!stroke.shiftKey) return null;
  const commands: Readonly<Record<string, ComposeKeyCommand>> = {
    o: 'focus-to',
    f: 'focus-from',
    s: 'focus-subject',
    m: 'focus-message',
    ',': 'close-draft',
    '<': 'close-draft',
  };
  return commands[key] ?? null;
}

export function accountIndexForCommand(command: EmailKeyCommand): number | null {
  const index = accountKeyCommands.indexOf(command as AccountKeyCommand);
  return index >= 0 ? index : null;
}
