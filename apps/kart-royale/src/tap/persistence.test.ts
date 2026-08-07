import { afterEach, describe, expect, it } from '@rstest/core';
import { load, save, DEFAULTS } from '../core/ControlPrefs';
import { hydrateControlPrefs, TAP_STORAGE_NAMESPACE } from './persistence';

const SDK_SYMBOL = Symbol.for('tap.internal.v1');
const USER = 'user-1';
const KEY = `users/${USER}/control-prefs`;

function installFakeSdk(seed?: { value: unknown; revision: number }) {
  const documents = new Map<string, { value: unknown; revision: number }>();
  if (seed) documents.set(`${TAP_STORAGE_NAMESPACE}/${KEY}`, seed);
  (globalThis as Record<PropertyKey, unknown>)[SDK_SYMBOL] = {
    storage: {
      get({ namespace, key }: { namespace: string; key: string }) {
        const doc = documents.get(`${namespace}/${key}`);
        return Promise.resolve({
          value: doc ? structuredClone(doc.value) : null,
          revision: doc ? doc.revision : null,
        });
      },
      set({
        namespace,
        key,
        value,
        expectedRevision,
      }: {
        namespace: string;
        key: string;
        value: unknown;
        expectedRevision: number | null;
      }) {
        const id = `${namespace}/${key}`;
        const current = documents.get(id)?.revision ?? null;
        if (current !== expectedRevision) {
          return Promise.reject(new Error('revision conflict'));
        }
        const revision = (current ?? 0) + 1;
        documents.set(id, { value: structuredClone(value), revision });
        return Promise.resolve({ revision });
      },
    },
  };
  return documents;
}

/** Flush the fire-and-forget write-through queue. */
async function flushWrites(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));
}

afterEach(() => {
  delete (globalThis as Record<PropertyKey, unknown>)[SDK_SYMBOL];
});

describe('TAP control-prefs persistence', () => {
  it('hydrates the stored record into the synchronous load()', async () => {
    installFakeSdk({
      value: { ...DEFAULTS, scheme: 'buttons', hand: 'left' },
      revision: 3,
    });
    await hydrateControlPrefs(USER);
    const prefs = load();
    expect(prefs.scheme).toBe('buttons');
    expect(prefs.hand).toBe('left');
  });

  it('writes saves through to TAP storage', async () => {
    const documents = installFakeSdk();
    await hydrateControlPrefs(USER);
    save({ ...DEFAULTS, scheme: 'tilt' });
    await flushWrites();
    const doc = documents.get(`${TAP_STORAGE_NAMESPACE}/${KEY}`);
    expect(doc?.revision).toBe(1);
    expect(doc?.value).toMatchObject({ scheme: 'tilt' });
  });

  it('keeps serving writes from memory when storage fails', async () => {
    (globalThis as Record<PropertyKey, unknown>)[SDK_SYMBOL] = {
      storage: {
        get: () => Promise.reject(new Error('denied')),
        set: () => Promise.reject(new Error('denied')),
      },
    };
    await hydrateControlPrefs(USER);
    expect(load()).toEqual({ ...DEFAULTS });
    save({ ...DEFAULTS, scheme: 'fixed' });
    await flushWrites();
    expect(load().scheme).toBe('fixed');
  });
});
