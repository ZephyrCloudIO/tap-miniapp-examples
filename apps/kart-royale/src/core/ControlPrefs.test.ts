import { afterEach, describe, expect, it } from '@rstest/core';
import {
  DEFAULTS,
  installControlPrefsBackend,
  load,
  save,
  type ControlPrefsData,
} from './ControlPrefs';

/** An in-memory backend capturing the raw record, like the TAP adapter's. */
function memoryBackend(initial: string | null = null) {
  const state = { raw: initial, writes: 0 };
  return {
    state,
    read() {
      return state.raw;
    },
    write(raw: string) {
      state.writes++;
      state.raw = raw;
    },
  };
}

afterEach(() => {
  // Restore the browser-default backend shape (absent localStorage in node
  // reads as null; writes are swallowed).
  installControlPrefsBackend({
    read: () => null,
    write: () => {},
  });
});

describe('ControlPrefs backend contract', () => {
  it('returns defaults when the backend has no record', () => {
    installControlPrefsBackend(memoryBackend());
    expect(load()).toEqual({ ...DEFAULTS });
  });

  it('hydrates a stored record through the installed backend', () => {
    const stored: ControlPrefsData = {
      ...DEFAULTS,
      scheme: 'buttons',
      hand: 'left',
      tutorialSeen: 1,
    };
    installControlPrefsBackend(memoryBackend(JSON.stringify(stored)));
    const prefs = load();
    expect(prefs.scheme).toBe('buttons');
    expect(prefs.hand).toBe('left');
    expect(prefs.tutorialSeen).toBe(1);
  });

  it('keeps valid fields when a stored record is partially corrupt', () => {
    installControlPrefsBackend(
      memoryBackend(JSON.stringify({ scheme: 'nonsense', hand: 'left' })),
    );
    const prefs = load();
    expect(prefs.scheme).toBe(DEFAULTS.scheme);
    expect(prefs.hand).toBe('left');
  });

  it('falls back to defaults on unparseable JSON', () => {
    installControlPrefsBackend(memoryBackend('{not json'));
    expect(load()).toEqual({ ...DEFAULTS });
  });

  it('writes saves through the installed backend', () => {
    const backend = memoryBackend();
    installControlPrefsBackend(backend);
    const next = { ...DEFAULTS, scheme: 'tilt' as const };
    save(next);
    expect(backend.state.writes).toBe(1);
    expect(JSON.parse(backend.state.raw!)).toMatchObject({ scheme: 'tilt' });
    expect(load().scheme).toBe('tilt');
  });
});
