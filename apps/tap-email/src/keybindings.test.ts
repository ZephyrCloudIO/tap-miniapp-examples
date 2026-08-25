import { describe, expect, it } from '@rstest/core';
import { resolveShortcut } from './keybindings';

describe('TAP Email keybindings', () => {
  it('preserves the Superhuman triage loop', () => {
    expect(resolveShortcut({ key: 'j' }, null).command).toBe('next');
    expect(resolveShortcut({ key: 'K' }, null).command).toBe('previous');
    expect(resolveShortcut({ key: 'h' }, null).command).toBe('remind');
    expect(resolveShortcut({ key: 'e' }, null).command).toBe('done');
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

  it('supports unified and single-account chords', () => {
    expect(resolveShortcut({ key: 'g' }, null).nextChord).toBe('g');
    expect(resolveShortcut({ key: 'a' }, 'g').command).toBe(
      'unified-account',
    );
    expect(resolveShortcut({ key: '1' }, 'g').command).toBe('account-1');
  });

  it('does not claim unrelated modified keys', () => {
    expect(resolveShortcut({ key: 'b', metaKey: true }, null)).toMatchObject({
      command: null,
      preventDefault: false,
    });
  });
});
