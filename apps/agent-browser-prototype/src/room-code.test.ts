import { describe, expect, it } from "@rstest/core";
import {
  decodeRemoteBrowserRoomCode,
  encodeRemoteBrowserRoomCode,
} from "./room-code";

const SESSION = "8f508329-5217-4be2-a605-b80bc12350c6";
const TOKEN = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdef";

describe("Remote Browser room code", () => {
  it("round-trips one versioned compact code containing the handle and token", () => {
    const code = encodeRemoteBrowserRoomCode({
      sessionHandle: SESSION,
      invitationToken: TOKEN,
    });

    expect(code).toMatch(/^RB1\.[0-9A-Za-z_-]{22}\./u);
    expect(code).not.toContain(SESSION);
    expect(decodeRemoteBrowserRoomCode(`  ${code}  `)).toEqual({
      sessionHandle: SESSION,
      invitationToken: TOKEN,
    });
  });

  it("rejects malformed versions, handles, and invitation tokens", () => {
    expect(() => decodeRemoteBrowserRoomCode("RB2.not-a-room")).toThrow(
      /valid Remote Browser room code/u,
    );
    expect(() => decodeRemoteBrowserRoomCode("RB1.AAAAAAAAAAAAAAAAAAAAAA.short")).toThrow(
      /valid Remote Browser room code/u,
    );
    expect(() =>
      encodeRemoteBrowserRoomCode({
        sessionHandle: "not-a-session",
        invitationToken: TOKEN,
      }),
    ).toThrow(/invalid room session handle/u);
  });
});
