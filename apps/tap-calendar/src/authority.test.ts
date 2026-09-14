import { afterEach, describe, expect, it, rs } from "@rstest/core";
import type { TapFederatedSurfaceMountContext } from "@theaiplatform/miniapp-sdk/surface";
import {
  CALENDAR_APPROVE_ACTION,
  CALENDAR_MANAGE_ACTION,
  CALENDAR_PUBLISH_ACTION,
  CALENDAR_VIEW_ACTION,
  CHANNELS_READ_ACTION,
  NETWORK_REQUEST_ACTION,
  hasCalendarAuthority,
  hasCalendarMountAuthority,
  requireCalendarAuthority,
  requireCalendarMountAuthority,
} from "./authority";

const SDK_SLOT = Symbol.for("tap.internal.v1");

afterEach(() => {
  Reflect.deleteProperty(globalThis, SDK_SLOT);
});

function context(
  hostAuthority: TapFederatedSurfaceMountContext["hostAuthority"],
): TapFederatedSurfaceMountContext {
  return {
    packageId: "tap_pkg_examples_tap_calendar_0001",
    packageNamespace: "examples-tap-calendar",
    releaseId: "tap_pkg_examples_tap_calendar_0001@0.1.0",
    installationId: "installation-1",
    contributionId: "tap-calendar",
    instanceId: "instance-1",
    hostOrigin: "https://host.example.test",
    packageAssetBaseUrl: "https://package.example.test/",
    workspaceId: "workspace-1",
    userId: "user-1",
    events: {
      publish: rs.fn(),
      subscribe: rs.fn(() => () => undefined),
    },
    entropy: {
      randomUUID: () => "00000000-0000-4000-8000-000000000001",
    },
    owner: {
      getSnapshot: () => ({
        workspaceId: "workspace-1",
        channelId: null,
        conversationId: null,
      }),
      subscribe: () => () => undefined,
    },
    launches: {
      subscribe: () => () => undefined,
    },
    hostAuthority,
  };
}

describe("TAP Calendar authority", () => {
  it("uses exact host mount admission for manifest-required surface reads", async () => {
    const check = rs.fn(async () => ({ allowed: false }));
    Reflect.set(globalThis, SDK_SLOT, {
      authorization: { check },
    });
    const hostContext = context({
      getSnapshot: () => true,
      subscribe: () => () => undefined,
    });

    await expect(
      hasCalendarMountAuthority(hostContext, false),
    ).resolves.toBe(true);
    await expect(
      requireCalendarMountAuthority(hostContext, false),
    ).resolves.toBeUndefined();
    expect(check).not.toHaveBeenCalled();
  });

  it("fails closed when an exact mount context is missing", async () => {
    await expect(
      hasCalendarMountAuthority(undefined, false),
    ).resolves.toBe(false);
    await expect(
      requireCalendarMountAuthority(undefined, false),
    ).rejects.toThrow("canonical user identity");

    const { userId: _userId, ...missingPrincipal } = context({
      getSnapshot: () => true,
      subscribe: () => () => undefined,
    });
    await expect(
      requireCalendarMountAuthority(missingPrincipal, false),
    ).rejects.toThrow("canonical user identity");
  });

  it("allows preview actions without consulting the host", async () => {
    await expect(
      hasCalendarAuthority(undefined, true, CALENDAR_VIEW_ACTION),
    ).resolves.toBe(true);
    await expect(
      requireCalendarAuthority(undefined, true, CALENDAR_PUBLISH_ACTION),
    ).resolves.toBeUndefined();
  });

  it("waits for mount authority and checks every action at its declared autonomy", async () => {
    let ready = false;
    const listeners = new Set<() => void>();
    const check = rs.fn(async () => ({ allowed: true }));
    Reflect.set(globalThis, SDK_SLOT, {
      authorization: { check },
    });
    const hostContext = context({
      getSnapshot: () => ready,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });

    const view = hasCalendarAuthority(
      hostContext,
      false,
      CALENDAR_VIEW_ACTION,
    );
    expect(check).not.toHaveBeenCalled();

    ready = true;
    for (const listener of listeners) listener();

    await expect(view).resolves.toBe(true);
    await expect(
      hasCalendarAuthority(hostContext, false, CALENDAR_MANAGE_ACTION),
    ).resolves.toBe(true);
    await expect(
      hasCalendarAuthority(hostContext, false, CALENDAR_APPROVE_ACTION),
    ).resolves.toBe(true);
    await expect(
      hasCalendarAuthority(hostContext, false, CALENDAR_PUBLISH_ACTION),
    ).resolves.toBe(true);
    await expect(
      hasCalendarAuthority(hostContext, false, CHANNELS_READ_ACTION),
    ).resolves.toBe(true);

    expect(check).toHaveBeenNthCalledWith(1, {
      actionId: "calendar.view",
      autonomy: "listen",
    });
    expect(check).toHaveBeenNthCalledWith(2, {
      actionId: "calendar.manage",
      autonomy: "do",
    });
    expect(check).toHaveBeenNthCalledWith(3, {
      actionId: "calendar.approve",
      autonomy: "do",
    });
    expect(check).toHaveBeenNthCalledWith(4, {
      actionId: "calendar.publish",
      autonomy: "do",
    });
    expect(check).toHaveBeenNthCalledWith(5, {
      actionId: "channels.read",
      autonomy: "listen",
    });
    expect(listeners.size).toBe(0);
  });

  it("fails closed for denials, host errors, and missing mount context", async () => {
    const check = rs
      .fn()
      .mockResolvedValueOnce({ allowed: false })
      .mockRejectedValueOnce(new Error("host unavailable"));
    Reflect.set(globalThis, SDK_SLOT, {
      authorization: { check },
    });
    const hostContext = context({
      getSnapshot: () => true,
      subscribe: () => () => undefined,
    });

    await expect(
      hasCalendarAuthority(hostContext, false, CALENDAR_MANAGE_ACTION),
    ).resolves.toBe(false);
    await expect(
      hasCalendarAuthority(hostContext, false, CALENDAR_APPROVE_ACTION),
    ).resolves.toBe(false);
    await expect(
      hasCalendarAuthority(undefined, false, CALENDAR_VIEW_ACTION),
    ).resolves.toBe(false);
  });

  it("fails closed when the host authority projection errors", async () => {
    const check = rs.fn(async () => ({ allowed: true }));
    Reflect.set(globalThis, SDK_SLOT, {
      authorization: { check },
    });
    const hostContext = context({
      getSnapshot: () => {
        throw new Error("projection unavailable");
      },
      subscribe: () => () => undefined,
    });

    await expect(
      hasCalendarAuthority(hostContext, false, CALENDAR_VIEW_ACTION),
    ).resolves.toBe(false);
    expect(check).not.toHaveBeenCalled();
  });

  it("reports the protected operation for every denied action", async () => {
    await expect(
      requireCalendarAuthority(undefined, false, CALENDAR_VIEW_ACTION),
    ).rejects.toThrow("does not allow this miniapp to view calendars");
    await expect(
      requireCalendarAuthority(undefined, false, CALENDAR_MANAGE_ACTION),
    ).rejects.toThrow("does not allow this miniapp to manage calendars");
    await expect(
      requireCalendarAuthority(undefined, false, CALENDAR_APPROVE_ACTION),
    ).rejects.toThrow("does not allow this miniapp to approve meeting requests");
    await expect(
      requireCalendarAuthority(undefined, false, CALENDAR_PUBLISH_ACTION),
    ).rejects.toThrow("does not allow this miniapp to publish booking pages");
    await expect(
      requireCalendarAuthority(undefined, false, NETWORK_REQUEST_ACTION),
    ).rejects.toThrow("does not allow this miniapp to reach the Calendar gateway");
    await expect(
      requireCalendarAuthority(undefined, false, CHANNELS_READ_ACTION),
    ).rejects.toThrow("does not allow this miniapp to read channel participants");
  });
});
