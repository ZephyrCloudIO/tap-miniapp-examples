import { sdk } from '@theaiplatform/miniapp-sdk/sdk';
import { emptyState, parseState, type CompanionState } from './domain';

const address = { namespace: 'vanta-companion', key: 'workspace/state-v3' } as const;
const legacyAddress = { namespace: 'vanta-companion', key: 'workspace/state-v2' } as const;
const previewKey = 'tap-example.vanta-companion.preview.v3';
const legacyPreviewKey = 'tap-example.vanta-companion.preview.v2';

export class ConflictError extends Error {
  constructor() {
    super('This workspace changed in another session. Reload and try again.');
  }
}

export async function loadState(preview: boolean): Promise<{ state: CompanionState; revision: number | null }> {
  if (preview) {
    const raw =
      globalThis.localStorage?.getItem(previewKey) ??
      globalThis.localStorage?.getItem(legacyPreviewKey);
    if (!raw) return { state: emptyState(), revision: null };
    try {
      return { state: parseState(JSON.parse(raw)) ?? emptyState(), revision: null };
    } catch {
      return { state: emptyState(), revision: null };
    }
  }
  const entry = await sdk.storage.get(address);
  if (entry.value === null) {
    const legacy = await sdk.storage.get(legacyAddress);
    return { state: parseState(legacy.value) ?? emptyState(), revision: null };
  }
  return { state: parseState(entry.value) ?? emptyState(), revision: entry.revision };
}

export async function saveState(state: CompanionState, revision: number | null, preview: boolean): Promise<number | null> {
  if (preview) {
    globalThis.localStorage?.setItem(previewKey, JSON.stringify(state));
    return null;
  }
  try {
    const result = await sdk.storage.set({ ...address, value: JSON.parse(JSON.stringify(state)), expectedRevision: revision });
    return result.revision;
  } catch (error) {
    if (error instanceof Error && /revision|conflict/i.test(error.message)) throw new ConflictError();
    throw error;
  }
}
