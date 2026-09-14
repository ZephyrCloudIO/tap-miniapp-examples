import { afterEach, describe, expect, it, rs } from '@rstest/core';
import type { TapFederatedSurfaceMountContext } from '@theaiplatform/miniapp-sdk/surface';
import {
  EMAIL_NETWORK_ACTION,
  HostAuthorityTimeoutError,
  hasEmailAuthority,
  waitForHostAuthority,
} from './authority';

const SDK_SLOT = Symbol.for('tap.internal.v1');

afterEach(() => {
  Reflect.deleteProperty(globalThis, SDK_SLOT);
});

function context(
  hostAuthority: TapFederatedSurfaceMountContext['hostAuthority'],
): TapFederatedSurfaceMountContext {
  return {
    packageId: 'tap_pkg_examples_tap_email_0001',
    packageNamespace: 'examples-tap-email',
    releaseId: 'tap_pkg_examples_tap_email_0001@0.1.0',
    installationId: 'installation-1',
    contributionId: 'tap-email',
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
    launches: {
      subscribe: () => () => undefined,
    },
    hostAuthority,
  };
}

describe('TAP Email host authority', () => {
  it('continues immediately when the host already confirmed the release', async () => {
    const subscribe = rs.fn(() => () => undefined);

    await expect(
      waitForHostAuthority(
        context({ getSnapshot: () => true, subscribe }),
      ),
    ).resolves.toBeUndefined();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('waits for confirmation and removes the authority subscription', async () => {
    let ready = false;
    const listeners = new Set<() => void>();
    const waiting = waitForHostAuthority(
      context({
        getSnapshot: () => ready,
        subscribe: listener => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      }),
      1_000,
    );

    expect(listeners.size).toBe(1);
    ready = true;
    for (const listener of listeners) listener();

    await expect(waiting).resolves.toBeUndefined();
    expect(listeners.size).toBe(0);
  });

  it('cleans up when subscribe publishes a confirmed snapshot synchronously', async () => {
    let ready = false;
    const unsubscribe = rs.fn();

    await expect(
      waitForHostAuthority(
        context({
          getSnapshot: () => ready,
          subscribe: listener => {
            ready = true;
            listener();
            return unsubscribe;
          },
        }),
        1_000,
      ),
    ).resolves.toBeUndefined();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('fails closed instead of hanging when the host never confirms authority', async () => {
    const listeners = new Set<() => void>();
    const waiting = waitForHostAuthority(
      context({
        getSnapshot: () => false,
        subscribe: listener => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      }),
      0,
    );

    await expect(waiting).rejects.toEqual(
      expect.objectContaining({
        name: 'HostAuthorityTimeoutError',
        code: 'host_authority_timeout',
      } satisfies Partial<HostAuthorityTimeoutError>),
    );
    expect(listeners.size).toBe(0);
  });

  it('still checks the exact governed action after host confirmation', async () => {
    const check = rs.fn(async () => ({ allowed: true }));
    Reflect.set(globalThis, SDK_SLOT, {
      authorization: { check },
    });

    await expect(
      hasEmailAuthority(
        context({
          getSnapshot: () => true,
          subscribe: () => () => undefined,
        }),
        EMAIL_NETWORK_ACTION,
      ),
    ).resolves.toBe(true);
    expect(check).toHaveBeenCalledWith({
      actionId: 'network.request',
      autonomy: 'do',
    });
  });
});
