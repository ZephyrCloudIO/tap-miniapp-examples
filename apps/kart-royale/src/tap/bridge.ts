/**
 * ============================================================================
 *  TAP SDK BRIDGE (packaged mode)
 * ============================================================================
 *  Thin error-classifying wrapper over the SDK's typed `sdk` facade. The SDK
 *  is a lazy proxy over the host-injected global (`Symbol.for('tap.internal.v1')`)
 *  that throws outside the packaged runtime, so availability is probed through
 *  the global directly and every call is mapped onto a typed BridgeError.
 *
 *  Only the storage API is bridged for now. Presence, host-mediated HTTP and
 *  package events arrive with the multiplayer work and extend this file.
 * ============================================================================
 */
import { sdk } from '@theaiplatform/miniapp-sdk/sdk';

const SDK_SYMBOL = Symbol.for('tap.internal.v1');

/** True when running as a packaged TAP surface rather than the browser preview. */
export function isTapRuntime(): boolean {
  return Reflect.get(globalThis, SDK_SYMBOL) != null;
}

export class BridgeError extends Error {
  readonly kind: 'unavailable' | 'operation' | 'invalid' | 'conflict';
  constructor(kind: BridgeError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface Stored<T> {
  value: T | null;
  revision: number | null;
}

function classify(error: unknown): BridgeError {
  if (String(error).toLowerCase().includes('revision')) {
    return new BridgeError('conflict', 'TAP storage revision conflict');
  }
  if (String(error).includes('outside a supported environment')) {
    return new BridgeError('unavailable', 'TAP SDK is unavailable');
  }
  return new BridgeError('operation', `TAP storage operation failed: ${String(error)}`);
}

/** Read one namespaced JSON document. Missing keys resolve to nulls. */
export async function storageGet<T>(namespace: string, key: string): Promise<Stored<T>> {
  if (!isTapRuntime()) throw new BridgeError('unavailable', 'TAP storage is unavailable');
  try {
    const result = await sdk.storage.get({ namespace, key });
    return {
      value: (result.value ?? null) as T | null,
      revision: result.revision ?? null,
    };
  } catch (error) {
    throw classify(error);
  }
}

/** CAS-write one namespaced JSON document. Conflicts throw BridgeError('conflict'). */
export async function storageSet<T>(
  namespace: string,
  key: string,
  value: T,
  expectedRevision: number | null,
): Promise<number> {
  if (!isTapRuntime()) throw new BridgeError('unavailable', 'TAP storage is unavailable');
  try {
    const result = await sdk.storage.set({
      namespace,
      key,
      value: value as never,
      expectedRevision,
    });
    return result.revision;
  } catch (error) {
    throw classify(error);
  }
}
