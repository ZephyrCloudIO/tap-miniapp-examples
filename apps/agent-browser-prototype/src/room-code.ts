export interface RemoteBrowserRoomInvitation {
  readonly sessionHandle: string;
  readonly invitationToken: string;
}

const ROOM_CODE_PREFIX = "RB1.";
const SESSION_HANDLE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const COMPACT_HANDLE = /^[0-9A-Za-z_-]{22}$/u;
const INVITATION_TOKEN = /^[0-9A-Za-z_-]{43}$/u;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!COMPACT_HANDLE.test(value)) {
    throw new Error("Enter a valid Remote Browser room code.");
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/") + "==";
  let binary: string;
  try {
    binary = globalThis.atob(base64);
  } catch {
    throw new Error("Enter a valid Remote Browser room code.");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function compactSessionHandle(sessionHandle: string): string {
  if (!SESSION_HANDLE.test(sessionHandle)) {
    throw new Error("Remote Browser returned an invalid room session handle.");
  }
  const hex = sessionHandle.replaceAll("-", "");
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytesToBase64Url(bytes);
}

function expandSessionHandle(value: string): string {
  const bytes = base64UrlToBytes(value);
  if (bytes.byteLength !== 16) {
    throw new Error("Enter a valid Remote Browser room code.");
  }
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const sessionHandle = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
  if (!SESSION_HANDLE.test(sessionHandle)) {
    throw new Error("Enter a valid Remote Browser room code.");
  }
  return sessionHandle;
}

function invitationToken(value: string, source: "gateway" | "room code"): string {
  if (!INVITATION_TOKEN.test(value)) {
    throw new Error(
      source === "gateway"
        ? "Remote Browser returned an invalid room invitation token."
        : "Enter a valid Remote Browser room code.",
    );
  }
  return value;
}

export function encodeRemoteBrowserRoomCode(
  invitation: RemoteBrowserRoomInvitation,
): string {
  return `${ROOM_CODE_PREFIX}${compactSessionHandle(invitation.sessionHandle)}.${invitationToken(invitation.invitationToken, "gateway")}`;
}

export function decodeRemoteBrowserRoomCode(
  roomCode: string,
): RemoteBrowserRoomInvitation {
  const normalized = roomCode.trim();
  if (!normalized.startsWith(ROOM_CODE_PREFIX) || normalized.length > 70) {
    throw new Error("Enter a valid Remote Browser room code.");
  }
  const compactAndToken = normalized.slice(ROOM_CODE_PREFIX.length);
  const separator = compactAndToken.indexOf(".");
  if (separator < 0) {
    throw new Error("Enter a valid Remote Browser room code.");
  }
  return Object.freeze({
    sessionHandle: expandSessionHandle(compactAndToken.slice(0, separator)),
    invitationToken: invitationToken(
      compactAndToken.slice(separator + 1),
      "room code",
    ),
  });
}
