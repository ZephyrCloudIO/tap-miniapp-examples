export interface RemoteBrowserRoomInvitation {
  readonly sessionHandle: string;
  readonly invitationToken: string;
}

export const REMOTE_BROWSER_ROOM_CODE_PATTERN =
  /^RB1\.[0-9A-Za-z_-]{22}\.[0-9A-Za-z_-]{43}$/u;

const SESSION_HANDLE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function invalidRoomCode(): never {
  throw new Error("Enter the RB1 Remote Browser room code exactly as shown.");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function compactHandleBytes(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/") + "==";
  let binary: string;
  try {
    binary = globalThis.atob(base64);
  } catch {
    return invalidRoomCode();
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength !== 16 || bytesToBase64Url(bytes) !== value) {
    return invalidRoomCode();
  }
  return bytes;
}

function expandSessionHandle(value: string): string {
  const hex = Array.from(
    compactHandleBytes(value),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const sessionHandle = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
  if (!SESSION_HANDLE.test(sessionHandle)) return invalidRoomCode();
  return sessionHandle;
}

/** Decode the exact versioned room code emitted by the Remote Browser miniapp. */
export function decodeRemoteBrowserRoomCode(
  roomCode: string,
): RemoteBrowserRoomInvitation {
  if (!REMOTE_BROWSER_ROOM_CODE_PATTERN.test(roomCode)) return invalidRoomCode();
  const [, compactHandle, invitationToken] = roomCode.split(".");
  if (!compactHandle || !invitationToken) return invalidRoomCode();
  return Object.freeze({
    sessionHandle: expandSessionHandle(compactHandle),
    invitationToken,
  });
}

export function isRemoteBrowserRoomCode(value: string): boolean {
  try {
    decodeRemoteBrowserRoomCode(value);
    return true;
  } catch {
    return false;
  }
}
