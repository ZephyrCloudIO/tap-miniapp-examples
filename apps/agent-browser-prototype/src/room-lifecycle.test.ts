import { describe, expect, it, rs } from "@rstest/core";
import { settleRemoteBrowserSession } from "./app";
import type { RemoteBrowserMcpClient } from "./remote-browser-mcp";

const SESSION = "8f508329-5217-4be2-a605-b80bc12350c6";

describe("shared room lifecycle", () => {
  it("leaves membership without closing the browser when a surface departs", async () => {
    const leave = rs.fn<RemoteBrowserMcpClient["leave"]>(async () => ({
      sessionHandle: SESSION,
      participantId: `rp_${"a".repeat(64)}`,
      status: "disconnected",
      control: {
        holder: "human",
        participantId: null,
        epoch: 2,
        expiresAt: null,
      },
    }));
    const close = rs.fn<RemoteBrowserMcpClient["close"]>();

    await settleRemoteBrowserSession({ leave, close }, SESSION, "leave");

    expect(leave).toHaveBeenCalledWith(SESSION);
    expect(close).not.toHaveBeenCalled();
  });

  it("closes only for the explicit owner end disposition", async () => {
    const leave = rs.fn<RemoteBrowserMcpClient["leave"]>();
    const close = rs.fn<RemoteBrowserMcpClient["close"]>(async () => ({
      sessionHandle: SESSION,
      state: "closed",
    }));

    await settleRemoteBrowserSession({ leave, close }, SESSION, "close");

    expect(close).toHaveBeenCalledWith(SESSION);
    expect(leave).not.toHaveBeenCalled();
  });
});
