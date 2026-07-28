import { describe, expect, it } from "@rstest/core";
import {
  hasReadableChannelAccess,
  initialPlayerChannelId,
  resolvePlayerStartupView,
} from "./player-startup";

const authorizedState = {
  preview: false,
  authority: true,
  viewAllowed: true,
  channelId: "channel-1",
  loading: true,
  hasChannelState: false,
} as const;

describe("resolvePlayerStartupView", () => {
  it("starts from an ambient channel only when the host supplies one", () => {
    expect(initialPlayerChannelId(false, " channel-1 ")).toBe("channel-1");
    expect(initialPlayerChannelId(false)).toBe("");
    expect(initialPlayerChannelId(true)).toBe("browser-preview-channel");
  });

  it("requires current participation and a readable channel capability", () => {
    expect(
      hasReadableChannelAccess({
        isParticipant: true,
        capabilities: ["message:create"],
      }),
    ).toBe(true);
    expect(
      hasReadableChannelAccess({
        isParticipant: false,
        capabilities: ["message:create"],
      }),
    ).toBe(false);
    expect(
      hasReadableChannelAccess({
        isParticipant: true,
        capabilities: ["channel:admin"],
      }),
    ).toBe(false);
  });

  it("shows channel selection for an authorized workspace surface without a channel context", () => {
    expect(
      resolvePlayerStartupView({
        ...authorizedState,
        channelId: "",
      }),
    ).toBe("select-channel");
  });

  it("keeps a channel-scoped surface loading until its soundtrack is hydrated", () => {
    expect(resolvePlayerStartupView(authorizedState)).toBe("loading");
  });

  it("does not expose channel selection before host authority and view authorization", () => {
    expect(
      resolvePlayerStartupView({
        ...authorizedState,
        authority: false,
        channelId: "",
      }),
    ).toBe("awaiting-authority");
    expect(
      resolvePlayerStartupView({
        ...authorizedState,
        viewAllowed: null,
        channelId: "",
      }),
    ).toBe("confirming-access");
  });
});
