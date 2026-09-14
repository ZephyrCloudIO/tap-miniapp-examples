/**
 * Temporary published-SDK compatibility bridge for the channel participant action.
 *
 * The current TAP host already implements `getChannelParticipants`, while the
 * published SDK runtime used by this package does not project
 * `sdk.channels.getParticipants` yet. Keep the host protocol in this isolated
 * module so it can be deleted as soon as the package upgrades to an SDK that
 * exposes the typed method.
 */

const HOST_ACTION_REQUEST = "tap-miniapp-host-action";
const HOST_ACTION_RESPONSE = "tap-miniapp-host-action-response";
const CHANNEL_PARTICIPANTS_ACTION = "getChannelParticipants";
const DOCUMENT_ID_KEY = Symbol.for("zephyrcloudio.miniapp.document-id");
const HOST_ACTION_TIMEOUT_MS = 4_000;
const MAX_PENDING_HOST_ACTIONS = 32;
const MAX_HOST_ACTION_ID_CHARS = 256;
const MAX_HOST_ORIGIN_CHARS = 2_048;
const MAX_CHANNEL_ID_CHARS = 512;
const MAX_HOST_ACTION_ERROR_CHARS = 1_024;
const MAX_HOST_ACTION_ERROR_CODE_CHARS = 128;

interface HostWindowProxy {
  postMessage(message: unknown, targetOrigin: string): void;
}

interface HostMessageEvent {
  readonly data: unknown;
  readonly origin: string;
  readonly source: unknown;
}

export interface Sdk07ChannelParticipantsEnvironment {
  readonly self: unknown;
  readonly parent: HostWindowProxy | null;
  readonly locationSearch: string;
  readonly referrer: string;
  readonly globalObject: object;
  readonly randomUUID: (() => string) | undefined;
  addMessageListener(listener: (event: HostMessageEvent) => void): void;
  removeMessageListener(listener: (event: HostMessageEvent) => void): void;
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(timer: unknown): void;
}

export interface Sdk07ChannelParticipantsCapability {
  getParticipants(input: { readonly channelId: string }): Promise<unknown>;
}

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isExactBoundedString = (
  value: unknown,
  maximumLength: number,
): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maximumLength &&
  value.trim() === value &&
  !/[\u0000-\u001f\u007f]/u.test(value);

const exactOrigin = (value: string | null | undefined): string | null => {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.origin === "null" || parsed.username || parsed.password
      ? null
      : parsed.origin;
  } catch {
    return null;
  }
};

const uniqueExactValue = (
  values: readonly (string | null)[],
  maximumLength: number,
): string | null => {
  const present = values.filter((value): value is string => value !== null);
  if (
    present.length === 0 ||
    present.some(value => !isExactBoundedString(value, maximumLength))
  ) {
    return null;
  }
  return new Set(present).size === 1 ? present[0]! : null;
};

const resolveHostOrigin = (
  environment: Sdk07ChannelParticipantsEnvironment,
  mountedHostOrigin: string,
): string | null => {
  const expected = exactOrigin(mountedHostOrigin);
  if (!expected || expected !== mountedHostOrigin) return null;

  const params = new URLSearchParams(environment.locationSearch);
  const queryOrigins = [
    ...params.getAll("hostOrigin"),
    ...params.getAll("miniappHostOrigin"),
  ].map(exactOrigin);
  if (queryOrigins.some(origin => origin === null)) return null;
  const discovered = queryOrigins.length > 0
    ? uniqueExactValue(queryOrigins, MAX_HOST_ORIGIN_CHARS)
    : exactOrigin(environment.referrer);
  return discovered === expected ? expected : null;
};

const resolveFrameInstanceId = (
  environment: Sdk07ChannelParticipantsEnvironment,
): string | null => {
  const params = new URLSearchParams(environment.locationSearch);
  return uniqueExactValue([
    ...params.getAll("miniappInstanceId"),
    ...params.getAll("instanceId"),
    ...params.getAll("miniappFrameId"),
  ], MAX_HOST_ACTION_ID_CHARS);
};

const readDocumentId = (
  environment: Sdk07ChannelParticipantsEnvironment,
): string | null => {
  const value = Reflect.get(environment.globalObject, DOCUMENT_ID_KEY);
  return isExactBoundedString(value, MAX_HOST_ACTION_ID_CHARS) ? value : null;
};

const isHostActionErrorCode = (value: unknown): value is string =>
  isExactBoundedString(value, MAX_HOST_ACTION_ERROR_CODE_CHARS) &&
  /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(value);

const hostActionError = (response: Record<PropertyKey, unknown>): Error => {
  const message = isExactBoundedString(
    response.error,
    MAX_HOST_ACTION_ERROR_CHARS,
  )
    ? response.error
    : "The miniapp host action failed.";
  const error = new Error(message);
  if (isHostActionErrorCode(response.errorCode)) {
    error.name = "MiniAppHostActionError";
    Object.defineProperty(error, "code", {
      configurable: false,
      enumerable: true,
      value: response.errorCode,
      writable: false,
    });
  }
  return error;
};

const browserEnvironment = (): Sdk07ChannelParticipantsEnvironment | null => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }
  const parent = window.parent;
  const randomUUID = globalThis.crypto?.randomUUID;
  return {
    self: window,
    parent: parent as unknown as HostWindowProxy,
    locationSearch: window.location.search,
    referrer: document.referrer,
    globalObject: globalThis,
    randomUUID: typeof randomUUID === "function"
      ? () => randomUUID.call(globalThis.crypto)
      : undefined,
    addMessageListener: listener => {
      window.addEventListener(
        "message",
        listener as unknown as EventListener,
      );
    },
    removeMessageListener: listener => {
      window.removeEventListener(
        "message",
        listener as unknown as EventListener,
      );
    },
    setTimer: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimer: timer => globalThis.clearTimeout(
      timer as ReturnType<typeof globalThis.setTimeout>,
    ),
  };
};

/**
 * Build only the one missing SDK method over the SDK host-action envelope.
 * Returning `null` is intentional whenever exact frame authority cannot be
 * established; callers then render the honest roster-unavailable state.
 */
export function createSdk07ChannelParticipantsCapability(
  mountedHostOrigin: string,
  injectedEnvironment?: Sdk07ChannelParticipantsEnvironment,
): Sdk07ChannelParticipantsCapability | null {
  const environment = injectedEnvironment ?? browserEnvironment();
  if (!environment) return null;
  const hostOrigin = resolveHostOrigin(environment, mountedHostOrigin);
  const instanceId = resolveFrameInstanceId(environment);
  const documentId = readDocumentId(environment);
  const parent = environment.parent;
  const randomUUID = environment.randomUUID;
  if (
    !hostOrigin ||
    !instanceId ||
    !documentId ||
    !parent ||
    parent === environment.self ||
    !randomUUID
  ) {
    return null;
  }

  let sequence = 0;
  let pending = 0;
  return {
    getParticipants: ({ channelId }) => {
      if (!isExactBoundedString(channelId, MAX_CHANNEL_ID_CHARS)) {
        return Promise.reject(new Error(
          "app.channels.getParticipants requires a bounded channelId.",
        ));
      }
      if (pending >= MAX_PENDING_HOST_ACTIONS) {
        return Promise.reject(new Error(
          "Too many miniapp host actions are pending.",
        ));
      }

      sequence += 1;
      const requestId =
        `tap-host-action-${sequence}-${randomUUID()}`;
      if (!isExactBoundedString(requestId, MAX_HOST_ACTION_ID_CHARS)) {
        return Promise.reject(new Error(
          "The miniapp host action identity is invalid.",
        ));
      }

      pending += 1;
      return new Promise((resolve, reject) => {
        let timer: unknown;
        let settled = false;
        const cleanup = () => {
          if (settled) return;
          settled = true;
          pending -= 1;
          environment.clearTimer(timer);
          environment.removeMessageListener(handleMessage);
        };
        const handleMessage = (event: HostMessageEvent) => {
          if (event.source !== parent || event.origin !== hostOrigin) return;
          if (!isRecord(event.data)) return;
          if (
            event.data.type !== HOST_ACTION_RESPONSE ||
            event.data.id !== requestId ||
            typeof event.data.ok !== "boolean"
          ) {
            return;
          }
          cleanup();
          if (event.data.ok) resolve(event.data.result);
          else reject(hostActionError(event.data));
        };

        try {
          environment.addMessageListener(handleMessage);
          timer = environment.setTimer(() => {
            cleanup();
            reject(new Error("The miniapp host action timed out."));
          }, HOST_ACTION_TIMEOUT_MS);
          parent.postMessage({
            type: HOST_ACTION_REQUEST,
            id: requestId,
            action: CHANNEL_PARTICIPANTS_ACTION,
            documentId,
            payload: { options: { channelId } },
            instanceId,
          }, hostOrigin);
        } catch (error) {
          cleanup();
          reject(error);
        }
      });
    },
  };
}
