import { describe, expect, it, rs } from "@rstest/core";
import {
  createSdk07ChannelParticipantsCapability,
  type Sdk07ChannelParticipantsEnvironment,
} from "./channel-participants-sdk07-compat";

const DOCUMENT_ID_KEY = Symbol.for("zephyrcloudio.miniapp.document-id");

function hostHarness(options: {
  readonly locationSearch?: string;
  readonly mountedHostOrigin?: string;
  readonly documentId?: string;
  readonly parentIsSelf?: boolean;
} = {}) {
  const self = {};
  const posted: Array<{ readonly message: unknown; readonly origin: string }> = [];
  const parent = options.parentIsSelf
    ? self
    : {
        postMessage(message: unknown, origin: string) {
          posted.push({ message, origin });
        },
      };
  const globalObject = {};
  if (options.documentId !== "") {
    Reflect.set(
      globalObject,
      DOCUMENT_ID_KEY,
      options.documentId ?? "document-1",
    );
  }
  const listeners = new Set<(event: {
    readonly data: unknown;
    readonly origin: string;
    readonly source: unknown;
  }) => void>();
  const timers = new Map<object, () => void>();
  const removed = rs.fn();
  const environment: Sdk07ChannelParticipantsEnvironment = {
    self,
    parent: parent as Sdk07ChannelParticipantsEnvironment["parent"],
    locationSearch: options.locationSearch ??
      "?hostOrigin=https%3A%2F%2Fhost.example.test&instanceId=frame-1",
    referrer: "",
    globalObject,
    randomUUID: () => "00000000-0000-4000-8000-000000000001",
    addMessageListener: listener => listeners.add(listener),
    removeMessageListener: listener => {
      listeners.delete(listener);
      removed(listener);
    },
    setTimer: callback => {
      const timer = {};
      timers.set(timer, callback);
      return timer;
    },
    clearTimer: timer => {
      if (typeof timer === "object" && timer !== null) timers.delete(timer);
    },
  };
  const capability = createSdk07ChannelParticipantsCapability(
    options.mountedHostOrigin ?? "https://host.example.test",
    environment,
  );
  return {
    capability,
    parent,
    posted,
    removed,
    dispatch(data: unknown, origin = "https://host.example.test", source = parent) {
      for (const listener of [...listeners]) listener({ data, origin, source });
    },
    timeout() {
      for (const callback of [...timers.values()]) callback();
    },
  };
}

describe("published SDK channel participant compatibility", () => {
  it("sends the exact current-frame host action envelope", async () => {
    const host = hostHarness({
      locationSearch:
        "?hostOrigin=https%3A%2F%2Fhost.example.test" +
        "&miniappInstanceId=frame-1&instanceId=frame-1&miniappFrameId=frame-1",
    });
    const pending = host.capability!.getParticipants({ channelId: "channel-1" });
    expect(host.posted).toHaveLength(1);
    const request = host.posted[0]!;
    expect(request.origin).toBe("https://host.example.test");
    expect(request.message).toEqual({
      type: "tap-miniapp-host-action",
      id: "tap-host-action-1-00000000-0000-4000-8000-000000000001",
      action: "getChannelParticipants",
      documentId: "document-1",
      payload: { options: { channelId: "channel-1" } },
      instanceId: "frame-1",
    });

    host.dispatch({
      type: "tap-miniapp-host-action-response",
      id: "tap-host-action-1-00000000-0000-4000-8000-000000000001",
      ok: true,
      result: { participants: [] },
    });
    await expect(pending).resolves.toEqual({ participants: [] });
    expect(host.removed).toHaveBeenCalledTimes(1);
  });

  it("ignores spoofed sources, origins, ids, and malformed responses", async () => {
    const host = hostHarness();
    let settled = false;
    const pending = host.capability!.getParticipants({ channelId: "channel-1" })
      .finally(() => {
        settled = true;
      });
    const id = Reflect.get(host.posted[0]!.message as object, "id");
    const success = {
      type: "tap-miniapp-host-action-response",
      id,
      ok: true,
      result: { participants: [] },
    };

    host.dispatch(success, "https://attacker.example.test");
    host.dispatch(success, "https://host.example.test", {});
    host.dispatch({ ...success, id: "another-request" });
    host.dispatch({ ...success, ok: "true" });
    await Promise.resolve();
    expect(settled).toBe(false);

    host.dispatch(success);
    await expect(pending).resolves.toEqual({ participants: [] });
  });

  it("preserves bounded host errors and times out with listener cleanup", async () => {
    const failedHost = hostHarness();
    const failed = failedHost.capability!.getParticipants({
      channelId: "channel-1",
    });
    const id = Reflect.get(failedHost.posted[0]!.message as object, "id");
    failedHost.dispatch({
      type: "tap-miniapp-host-action-response",
      id,
      ok: false,
      error: "Channel access is denied.",
      errorCode: "channel.access-denied",
    });
    await expect(failed).rejects.toMatchObject({
      name: "MiniAppHostActionError",
      message: "Channel access is denied.",
      code: "channel.access-denied",
    });

    const timedHost = hostHarness();
    const timed = timedHost.capability!.getParticipants({
      channelId: "channel-1",
    });
    timedHost.timeout();
    await expect(timed).rejects.toThrow("host action timed out");
    expect(timedHost.removed).toHaveBeenCalledTimes(1);
  });

  it("fails closed when exact frame authority is missing or ambiguous", () => {
    expect(hostHarness({
      mountedHostOrigin: "https://another-host.example.test",
    }).capability).toBeNull();
    expect(hostHarness({
      locationSearch:
        "?hostOrigin=https%3A%2F%2Fhost.example.test" +
        "&miniappHostOrigin=https%3A%2F%2Fattacker.example.test" +
        "&instanceId=frame-1",
    }).capability).toBeNull();
    expect(hostHarness({
      locationSearch:
        "?hostOrigin=https%3A%2F%2Fhost.example.test" +
        "&instanceId=frame-1&miniappFrameId=frame-2",
    }).capability).toBeNull();
    expect(hostHarness({ documentId: "" }).capability).toBeNull();
    expect(hostHarness({ parentIsSelf: true }).capability).toBeNull();
  });

  it("rejects unbounded channel identities before posting", async () => {
    const host = hostHarness();
    await expect(host.capability!.getParticipants({
      channelId: `channel-${"x".repeat(512)}`,
    })).rejects.toThrow("bounded channelId");
    expect(host.posted).toHaveLength(0);
  });
});
