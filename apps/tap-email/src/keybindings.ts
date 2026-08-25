export type EmailKeyCommand =
  | 'next'
  | 'previous'
  | 'remind'
  | 'done'
  | 'undo'
  | 'compose'
  | 'reply'
  | 'search'
  | 'palette'
  | 'bring-to-conversation'
  | 'toggle-star'
  | 'show-shortcuts'
  | 'unified-account'
  | 'account-1'
  | 'account-2'
  | 'inbox-split'
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

export const SHORTCUTS: readonly {
  command: EmailKeyCommand;
  keys: string;
  label: string;
  group: 'Triage' | 'Write' | 'Navigate' | 'TAP';
}[] = [
  { command: 'next', keys: 'J', label: 'Next thread', group: 'Triage' },
  { command: 'previous', keys: 'K', label: 'Previous thread', group: 'Triage' },
  { command: 'remind', keys: 'H', label: 'Remind me', group: 'Triage' },
  { command: 'done', keys: 'E', label: 'Mark done', group: 'Triage' },
  { command: 'undo', keys: 'Z', label: 'Undo', group: 'Triage' },
  { command: 'toggle-star', keys: 'S', label: 'Star / unstar', group: 'Triage' },
  { command: 'compose', keys: 'C', label: 'Compose', group: 'Write' },
  { command: 'reply', keys: 'R', label: 'Reply', group: 'Write' },
  { command: 'search', keys: '/', label: 'Search mail', group: 'Navigate' },
  { command: 'palette', keys: '⌘K', label: 'Command palette', group: 'Navigate' },
  { command: 'unified-account', keys: 'G A', label: 'Unified inbox', group: 'Navigate' },
  { command: 'account-1', keys: 'G 1', label: 'Account 1', group: 'Navigate' },
  { command: 'account-2', keys: 'G 2', label: 'Account 2', group: 'Navigate' },
  { command: 'inbox-split', keys: 'G I', label: 'Inbox', group: 'Navigate' },
  { command: 'critical-split', keys: 'G C', label: 'Critical', group: 'Navigate' },
  {
    command: 'needs-response-split',
    keys: 'G N',
    label: 'Needs response',
    group: 'Navigate',
  },
  { command: 'waiting-split', keys: 'G W', label: 'Waiting', group: 'Navigate' },
  { command: 'reminders-split', keys: 'G R', label: 'Reminders', group: 'Navigate' },
  {
    command: 'bring-to-conversation',
    keys: 'B',
    label: 'Bring to conversation',
    group: 'TAP',
  },
  { command: 'show-shortcuts', keys: '?', label: 'Keyboard shortcuts', group: 'TAP' },
] as const;

export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    Boolean(target.closest('[role="textbox"]'))
  );
}

export function resolveShortcut(
  stroke: KeyStroke,
  chord: 'g' | null,
): ShortcutResolution {
  const key = stroke.key.length === 1 ? stroke.key.toLowerCase() : stroke.key;
  const commandModifier = Boolean(stroke.metaKey || stroke.ctrlKey);
  if (commandModifier && key === 'k') {
    return { command: 'palette', nextChord: null, preventDefault: true };
  }
  if (commandModifier || stroke.altKey) {
    return { command: null, nextChord: null, preventDefault: false };
  }
  if (chord === 'g') {
    const commands: Readonly<Record<string, EmailKeyCommand>> = {
      a: 'unified-account',
      '1': 'account-1',
      '2': 'account-2',
      i: 'inbox-split',
      c: 'critical-split',
      n: 'needs-response-split',
      w: 'waiting-split',
      r: 'reminders-split',
    };
    return {
      command: commands[key] ?? null,
      nextChord: null,
      preventDefault: Boolean(commands[key]),
    };
  }
  if (key === 'g') {
    return { command: null, nextChord: 'g', preventDefault: true };
  }
  const commands: Readonly<Record<string, EmailKeyCommand>> = {
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
    '?': 'show-shortcuts',
  };
  return {
    command: commands[key] ?? null,
    nextChord: null,
    preventDefault: Boolean(commands[key]),
  };
}
