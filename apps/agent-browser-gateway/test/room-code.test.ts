import { describe, expect, it } from "vitest";
import { encodeRemoteBrowserRoomCode } from "../../agent-browser-prototype/src/room-code";
import {
  decodeRemoteBrowserRoomCode,
  isRemoteBrowserRoomCode,
} from "../src/room-code";

const SESSION_HANDLE = "8f508329-5217-4be2-a605-b80bc12350c6";
const INVITATION_TOKEN = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdef";

describe("canonical Remote Browser room code", () => {
  it("decodes the exact RB1 code emitted by the packaged miniapp", () => {
    const roomCode = encodeRemoteBrowserRoomCode({
      sessionHandle: SESSION_HANDLE,
      invitationToken: INVITATION_TOKEN,
    });

    expect(roomCode).toMatch(/^RB1\./u);
    expect(decodeRemoteBrowserRoomCode(roomCode)).toEqual({
      sessionHandle: SESSION_HANDLE,
      invitationToken: INVITATION_TOKEN,
    });
    expect(isRemoteBrowserRoomCode(roomCode)).toBe(true);
  });

  it("rejects noncanonical, invalid-version, and padded aliases", () => {
    expect(isRemoteBrowserRoomCode(
      `RB1.${"A".repeat(22)}.${INVITATION_TOKEN}`,
    )).toBe(false);
    expect(() => decodeRemoteBrowserRoomCode(
      ` RB1.${"A".repeat(22)}.${INVITATION_TOKEN}`,
    )).toThrow(/exactly as shown/u);
    expect(() => decodeRemoteBrowserRoomCode(
      `RB1.${"A".repeat(21)}=.${INVITATION_TOKEN}`,
    )).toThrow(/exactly as shown/u);
  });
});
