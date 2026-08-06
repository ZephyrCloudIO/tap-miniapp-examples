import { afterEach, describe, expect, it } from '@rstest/core';
import { BridgeError, isTapRuntime, storageGet, storageSet } from './bridge';

const SDK_SYMBOL = Symbol.for('tap.internal.v1');

/** Install a fake host-injected SDK with in-memory CAS storage. */
function installFakeSdk() {
  const documents = new Map<string, { value: unknown; revision: number }>();
  const sdk = {
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
        const doc = documents.get(id);
        const current = doc ? doc.revision : null;
        if (current !== expectedRevision) {
          return Promise.reject(
            new Error(`revision conflict: expected ${expectedRevision}, have ${current}`),
          );
        }
        const revision = current === null ? 1 : current + 1;
        documents.set(id, { value: structuredClone(value), revision });
        return Promise.resolve({ revision });
      },
    },
  };
  (globalThis as Record<PropertyKey, unknown>)[SDK_SYMBOL] = sdk;
  return documents;
}

afterEach(() => {
  delete (globalThis as Record<PropertyKey, unknown>)[SDK_SYMBOL];
});

describe('TAP storage bridge', () => {
  it('reports the absence of the SDK outside the packaged runtime', () => {
    expect(isTapRuntime()).toBe(false);
  });

  it('reads missing keys as nulls', async () => {
    installFakeSdk();
    expect(isTapRuntime()).toBe(true);
    await expect(storageGet('kart-royale', 'missing')).resolves.toEqual({
      value: null,
      revision: null,
    });
  });

  it('round-trips a document with CAS revisions', async () => {
    installFakeSdk();
    const rev1 = await storageSet('kart-royale', 'k', { a: 1 }, null);
    expect(rev1).toBe(1);
    const stored = await storageGet<{ a: number }>('kart-royale', 'k');
    expect(stored).toEqual({ value: { a: 1 }, revision: 1 });
    const rev2 = await storageSet('kart-royale', 'k', { a: 2 }, stored.revision);
    expect(rev2).toBe(2);
  });

  it('classifies revision conflicts', async () => {
    installFakeSdk();
    await storageSet('kart-royale', 'k', { a: 1 }, null);
    await expect(storageSet('kart-royale', 'k', { a: 2 }, null)).rejects.toMatchObject({
      kind: 'conflict',
    });
    await expect(storageSet('kart-royale', 'k', { a: 2 }, null)).rejects.toBeInstanceOf(
      BridgeError,
    );
  });

  it('throws unavailable without an SDK', async () => {
    await expect(storageGet('kart-royale', 'k')).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });
});
