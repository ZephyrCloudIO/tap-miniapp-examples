import { sdk } from '@theaiplatform/miniapp-sdk/sdk';
import { migrateLedger, parseLedger, type LedgerState } from './domain';

const address = {
  namespace: 'personal-health-ledger',
  key: 'private/ledger-v1',
} as const;
const previewKey = 'tap-example.personal-health-ledger.preview.v1';
export class StorageConflictError extends Error {}

export interface LoadedLedger {
  readonly state: LedgerState | null;
  readonly revision: number | null;
}
export const loadLedger = async (preview: boolean): Promise<LoadedLedger> => {
  if (!preview) {
    const entry = await sdk.storage.get(address);
    if (entry.value === null) return { state: null, revision: entry.revision };
    const state = migrateLedger(entry.value);
    if (
      typeof entry.value !== 'object' ||
      entry.value === null ||
      !('schemaVersion' in entry.value) ||
      entry.value.schemaVersion !== state.schemaVersion
    ) {
      const migrated = await sdk.storage.set({
        ...address,
        expectedRevision: entry.revision,
        value: JSON.parse(JSON.stringify(state)),
      });
      return { state, revision: migrated.revision };
    }
    return { state, revision: entry.revision };
  }
  const raw = globalThis.localStorage?.getItem(previewKey);
  const state = raw ? parseLedger(raw) : null;
  if (state && JSON.parse(raw!).schemaVersion !== state.schemaVersion)
    globalThis.localStorage?.setItem(previewKey, JSON.stringify(state));
  return { state, revision: null };
};
export const saveLedger = async (
  state: LedgerState,
  preview: boolean,
  expectedRevision: number | null,
): Promise<number | null> => {
  const jsonValue = JSON.parse(JSON.stringify(state));
  if (!preview) {
    try {
      return (
        await sdk.storage.set({
          ...address,
          expectedRevision,
          value: jsonValue,
        })
      ).revision;
    } catch (error) {
      throw new StorageConflictError(
        error instanceof Error
          ? error.message
          : 'The ledger changed in another session.',
      );
    }
  }
  globalThis.localStorage?.setItem(previewKey, JSON.stringify(state));
  return null;
};
export const clearPreviewLedger = (): void =>
  globalThis.localStorage?.removeItem(previewKey);
