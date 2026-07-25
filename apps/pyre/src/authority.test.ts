import { afterEach, describe, expect, it, rs } from "@rstest/core";
import type { TapFederatedSurfaceMountContext } from "@theaiplatform/miniapp-sdk/surface";
import {
  PYRE_APPROVE_ACTION,
  PYRE_INVESTIGATE_ACTION,
  hasPyreAuthority,
  requirePyreAuthority,
} from "./authority";

const SDK_SLOT = Symbol.for("tap.internal.v1");

afterEach(() => {
  Reflect.deleteProperty(globalThis, SDK_SLOT);
});

function context(
  hostAuthority: TapFederatedSurfaceMountContext["hostAuthority"],
): TapFederatedSurfaceMountContext {
  return {
    packageId: "tap_pkg_examples_pyre_0001",
    packageNamespace: "examples-pyre",
    releaseId: "tap_pkg_examples_pyre_0001@0.1.0",
    installationId: "installation-1",
    contributionId: "pyre",
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
    hostAuthority,
  };
}

describe("Pyre product authority", () => {
  it("keeps preview mutations local without consulting the host", async () => {
    await expect(
      hasPyreAuthority(undefined, true, PYRE_INVESTIGATE_ACTION),
    ).resolves.toBe(true);
  });

  it("waits for mount authority and preserves each catalog autonomy ceiling", async () => {
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

    const investigate = hasPyreAuthority(
      hostContext,
      false,
      PYRE_INVESTIGATE_ACTION,
    );
    expect(check).not.toHaveBeenCalled();
    ready = true;
    for (const listener of listeners) listener();

    await expect(investigate).resolves.toBe(true);
    await expect(
      hasPyreAuthority(hostContext, false, PYRE_APPROVE_ACTION),
    ).resolves.toBe(true);
    expect(check).toHaveBeenNthCalledWith(1, {
      actionId: "pyre.investigate",
      autonomy: "plan",
    });
    expect(check).toHaveBeenNthCalledWith(2, {
      actionId: "pyre.approve",
      autonomy: "listen",
    });
    expect(listeners.size).toBe(0);
  });

  it("fails closed for denials, missing context, and host errors", async () => {
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
      requirePyreAuthority(
        hostContext,
        false,
        PYRE_INVESTIGATE_ACTION,
      ),
    ).rejects.toThrow("does not allow this miniapp to investigate incidents");
    await expect(
      hasPyreAuthority(hostContext, false, PYRE_APPROVE_ACTION),
    ).resolves.toBe(false);
    await expect(
      hasPyreAuthority(undefined, false, PYRE_APPROVE_ACTION),
    ).resolves.toBe(false);
  });
});
