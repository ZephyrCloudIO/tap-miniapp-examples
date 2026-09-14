import type {
  RemoteBrowserMcpClient,
  RemoteBrowserRoomState,
} from "./remote-browser-mcp";

const RECOVERY_KEY_PREFIX = "tap.remote-browser.room-recovery.v1:";
const SESSION_HANDLE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TOKENLESS_REJOIN_BACKOFF_MS = [0, 250, 750] as const;

export const MAX_CONSECUTIVE_PARTICIPANT_REJOINS = 3;

type TokenlessRejoinClient = Pick<RemoteBrowserMcpClient, "join">;

interface TokenlessRejoinOptions {
  readonly isCurrent?: () => boolean;
  readonly wait?: (delayMs: number) => Promise<void>;
}

export class ParticipantRejoinBudgetExhaustedError extends Error {
  readonly code = "participant_rejoin_exhausted";

  constructor() {
    super(
      "This application session could not remain connected to the shared Remote Browser room.",
    );
    this.name = "ParticipantRejoinBudgetExhaustedError";
  }
}

function errorCode(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  const value = Reflect.get(error, "code");
  return typeof value === "string" ? value : null;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Advances a poller's consecutive rejoin budget. The counter is reset only by
 * a subsequent authenticated screenshot + room refresh, not merely by a join
 * response, so a participant that is immediately disconnected again cannot
 * loop forever.
 */
export function nextParticipantRejoinCycle(current: number): number {
  if (
    !Number.isSafeInteger(current) ||
    current < 0 ||
    current >= MAX_CONSECUTIVE_PARTICIPANT_REJOINS
  ) {
    throw new ParticipantRejoinBudgetExhaustedError();
  }
  return current + 1;
}

/**
 * Rejoins only the host-attested participant already bound to this mounted
 * app frame. Omitting invitationToken is intentional: the gateway accepts
 * this request only when the caller proves the exact prior participant.
 * Coded policy/session failures fail immediately; only unclassified transport
 * failures receive the bounded retry schedule.
 */
export async function rejoinRemoteBrowserParticipant(
  client: TokenlessRejoinClient,
  sessionHandle: string,
  options: TokenlessRejoinOptions = {},
): Promise<RemoteBrowserRoomState | null> {
  const isCurrent = options.isCurrent ?? (() => true);
  const pause = options.wait ?? wait;
  let lastFailure: unknown = new Error(
    "The application session could not rejoin the Remote Browser room.",
  );

  for (const delayMs of TOKENLESS_REJOIN_BACKOFF_MS) {
    if (!isCurrent()) return null;
    if (delayMs > 0) await pause(delayMs);
    if (!isCurrent()) return null;
    try {
      const joined = await client.join({ sessionHandle });
      return isCurrent() ? joined : null;
    } catch (cause) {
      if (!isCurrent()) return null;
      lastFailure = cause;
      if (errorCode(cause) !== null) throw cause;
    }
  }

  throw lastFailure;
}

type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): RecoveryStorage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function remoteBrowserRecoveryStorageKey(
  hostInstanceId: string | undefined,
): string | null {
  if (
    !hostInstanceId ||
    hostInstanceId.length > 512 ||
    hostInstanceId.trim() !== hostInstanceId ||
    /[\u0000-\u001f\u007f]/u.test(hostInstanceId)
  ) {
    return null;
  }
  return `${RECOVERY_KEY_PREFIX}${hostInstanceId}`;
}

export function rememberRemoteBrowserSession(
  hostInstanceId: string | undefined,
  sessionHandle: string,
  target: RecoveryStorage | null = storage(),
): void {
  const key = remoteBrowserRecoveryStorageKey(hostInstanceId);
  if (!key || !target || !SESSION_HANDLE.test(sessionHandle)) return;
  try {
    target.setItem(key, JSON.stringify({ version: 1, sessionHandle }));
  } catch {
    // Recovery is best-effort; room authority remains in the gateway.
  }
}

export function recalledRemoteBrowserSession(
  hostInstanceId: string | undefined,
  target: RecoveryStorage | null = storage(),
): string | null {
  const key = remoteBrowserRecoveryStorageKey(hostInstanceId);
  if (!key || !target) return null;
  try {
    const raw = target.getItem(key);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some(
        (field) => field !== "version" && field !== "sessionHandle",
      ) ||
      Reflect.get(value, "version") !== 1 ||
      typeof Reflect.get(value, "sessionHandle") !== "string" ||
      !SESSION_HANDLE.test(Reflect.get(value, "sessionHandle"))
    ) {
      target.removeItem(key);
      return null;
    }
    return Reflect.get(value, "sessionHandle") as string;
  } catch {
    try {
      target.removeItem(key);
    } catch {
      // Ignore unavailable storage during teardown.
    }
    return null;
  }
}

export function forgetRemoteBrowserSession(
  hostInstanceId: string | undefined,
  target: RecoveryStorage | null = storage(),
): void {
  const key = remoteBrowserRecoveryStorageKey(hostInstanceId);
  if (!key || !target) return;
  try {
    target.removeItem(key);
  } catch {
    // Ignore unavailable storage during teardown.
  }
}
