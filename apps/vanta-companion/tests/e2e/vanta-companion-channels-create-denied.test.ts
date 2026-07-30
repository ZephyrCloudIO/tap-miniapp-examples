import { expect, test } from '@theaiplatform/miniapp-sdk/testing/rstest';
import {
  expectExactProvenance,
  hasHostAuthorizationDecision,
  installCompanion,
  storedState,
} from './vanta-companion-test-support';

test('preserves package projections when channel creation is denied', async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    profileId: 'vanta-companion-desktop-channels-create-denied',
    matrixEntryId: 'vanta-companion-desktop-channels-create-denied',
    permissionScenario: 'deny:channels.create',
    seed: 6932,
    theme: 'dark',
  });
  await installCompanion(surface);
  await expect(surface.getByRole('alert')).toContainText(
    /host action permission is not granted/iu,
  );

  const entries = (await tap.fixture.ledger.read()).entries;
  for (const actionId of ['vanta-companion.coordinate'] as const) {
    expect(
      hasHostAuthorizationDecision(entries, {
        actionId,
        autonomy: 'do',
        allowed: true,
      }),
    ).toBe(true);
  }
  expect(
    hasHostAuthorizationDecision(entries, {
      actionId: 'channels.create',
      autonomy: 'do',
      allowed: false,
    }),
  ).toBe(true);
  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.state.specialists.map(item => item.id).sort()).toEqual([
    'vanta-soc2-companion-aus',
    'vanta-soc2-companion-eu',
    'vanta-soc2-companion-us',
  ]);
  expect(
    snapshot.state.channels.filter(
      channel => channel.title === 'Vanta SOC 2 operations',
    ),
  ).toEqual([]);
  expect(Reflect.get(storedState(snapshot), 'settings')).toMatchObject({
    specialistId: null,
    channelId: null,
  });
  expect(snapshot.state.storage[0]?.revision).toBe(1);
});
