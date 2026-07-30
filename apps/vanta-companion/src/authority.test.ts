import { afterEach, describe, expect, it, rs } from '@rstest/core';
import type { TapFederatedSurfaceMountContext } from '@theaiplatform/miniapp-sdk/surface';
import {
  VANTA_ANALYZE_ACTION,
  VANTA_COORDINATE_ACTION,
  hasVantaAuthority,
  requireVantaAuthority,
} from './authority';

const SDK_SLOT = Symbol.for('tap.internal.v1');

afterEach(() => {
  Reflect.deleteProperty(globalThis, SDK_SLOT);
});

function context(
  hostAuthority: TapFederatedSurfaceMountContext['hostAuthority'],
): TapFederatedSurfaceMountContext {
  return {
    packageId: 'tap_pkg_examples_vanta_companion_0001',
    packageNamespace: 'examples-vanta-companion',
    releaseId: 'tap_pkg_examples_vanta_companion_0001@0.1.0',
    installationId: 'installation-1',
    contributionId: 'vanta-companion',
    instanceId: 'instance-1',
    hostOrigin: 'https://host.example.test',
    packageAssetBaseUrl: 'https://package.example.test/',
    workspaceId: 'workspace-1',
    events: {
      publish: rs.fn(),
      subscribe: rs.fn(() => () => undefined),
    },
    entropy: {
      randomUUID: () => '00000000-0000-4000-8000-000000000001',
    },
    owner: {
      getSnapshot: () => ({
        workspaceId: 'workspace-1',
        channelId: null,
        conversationId: null,
      }),
      subscribe: () => () => undefined,
    },
    hostAuthority,
  };
}

describe('Vanta product authority', () => {
  it('keeps preview operations local without consulting the host', async () => {
    expect(
      await hasVantaAuthority(undefined, true, VANTA_COORDINATE_ACTION),
    ).toBe(true);
  });

  it('waits for mount authority and checks the exact product actions', async () => {
    let ready = false;
    const listeners = new Set<() => void>();
    const check = rs.fn(async () => ({ allowed: true }));
    Reflect.set(globalThis, SDK_SLOT, {
      authorization: { check },
    });
    const hostContext = context({
      getSnapshot: () => ready,
      subscribe: listener => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });

    const coordinate = hasVantaAuthority(
      hostContext,
      false,
      VANTA_COORDINATE_ACTION,
    );
    expect(check).not.toHaveBeenCalled();
    ready = true;
    for (const listener of listeners) listener();

    await expect(coordinate).resolves.toBe(true);
    await expect(
      hasVantaAuthority(hostContext, false, VANTA_ANALYZE_ACTION),
    ).resolves.toBe(true);
    expect(check).toHaveBeenNthCalledWith(1, {
      actionId: 'vanta-companion.coordinate',
      autonomy: 'do',
    });
    expect(check).toHaveBeenNthCalledWith(2, {
      actionId: 'vanta-companion.analyze',
      autonomy: 'plan',
    });
    expect(listeners.size).toBe(0);
  });

  it('fails closed for denial, a missing context, and host errors', async () => {
    const check = rs
      .fn()
      .mockResolvedValueOnce({ allowed: false })
      .mockRejectedValueOnce(new Error('host unavailable'));
    Reflect.set(globalThis, SDK_SLOT, {
      authorization: { check },
    });
    const hostContext = context({
      getSnapshot: () => true,
      subscribe: () => () => undefined,
    });

    await expect(
      requireVantaAuthority(
        hostContext,
        false,
        VANTA_COORDINATE_ACTION,
      ),
    ).rejects.toThrow('does not allow this miniapp to coordinate Vanta work');
    await expect(
      hasVantaAuthority(hostContext, false, VANTA_ANALYZE_ACTION),
    ).resolves.toBe(false);
    await expect(
      hasVantaAuthority(undefined, false, VANTA_ANALYZE_ACTION),
    ).resolves.toBe(false);
  });
});
