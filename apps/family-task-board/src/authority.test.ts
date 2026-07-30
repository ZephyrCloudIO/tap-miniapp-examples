import { afterEach, describe, expect, it, rs } from "@rstest/core";
import type { TapFederatedSurfaceMountContext } from "@theaiplatform/miniapp-sdk/surface";
import { canManageFamily } from "./authority";

const SDK_SLOT = Symbol.for("tap.internal.v1");

afterEach(() => {
  Reflect.deleteProperty(globalThis, SDK_SLOT);
});

function context(
  hostAuthority: TapFederatedSurfaceMountContext["hostAuthority"],
): TapFederatedSurfaceMountContext {
  return {
    packageId: "tap_pkg_examples_family_task_board_0001",
    packageNamespace: "examples-family-task-board",
    releaseId: "tap_pkg_examples_family_task_board_0001@0.1.0",
    installationId: "installation-1",
    contributionId: "family-task-board",
    instanceId: "instance-1",
    hostOrigin: "https://host.example.test",
    packageAssetBaseUrl: "https://package.example.test/",
    workspaceId: "workspace-1",
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
    hostAuthority,
  };
}

describe("family management authority", () => {
  it("keeps preview mutations local without consulting the host", async () => {
    expect(await canManageFamily(undefined, true)).toBe(true);
  });

  it("waits for mount authority and checks the exact write action", async () => {
    let ready = false;
    const listeners = new Set<() => void>();
    const check = rs.fn(async () => ({ allowed: false }));
    Reflect.set(globalThis, SDK_SLOT, {
      authorization: { check },
    });

    const decision = canManageFamily(
      context({
        getSnapshot: () => ready,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      }),
      false,
    );
    expect(check).not.toHaveBeenCalled();

    ready = true;
    for (const listener of listeners) listener();

    await expect(decision).resolves.toBe(false);
    expect(check).toHaveBeenCalledWith({
      actionId: "family-task-board.manage",
      autonomy: "do",
    });
    expect(listeners.size).toBe(0);
  });

  it("fails closed when host authorization is unavailable", async () => {
    Reflect.set(globalThis, SDK_SLOT, {
      authorization: {
        check: rs.fn(async () => {
          throw new Error("host unavailable");
        }),
      },
    });

    await expect(
      canManageFamily(
        context({
          getSnapshot: () => true,
          subscribe: () => () => undefined,
        }),
        false,
      ),
    ).resolves.toBe(false);
  });
});
