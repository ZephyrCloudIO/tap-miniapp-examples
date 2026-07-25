import { expect, test } from '@theaiplatform/miniapp-sdk/testing/rstest';
import {
  expectExactProvenance,
  hasHostAuthorizationDecision,
  installCompanion,
  storedState,
} from './vanta-companion-test-support';

test('exposes the orphan channel boundary when specialist join is denied', async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    profileId: 'vanta-companion-desktop-channels-manage-denied',
    matrixEntryId: 'vanta-companion-desktop-channels-manage-denied',
    permissionScenario: 'deny:channels.manage-specialists',
    seed: 6933,
    theme: 'dark',
  });
  await installCompanion(surface);
  await expect(surface.getByRole('alert')).toContainText(
    /host action permission is not granted/iu,
  );

  const entries = (await tap.fixture.ledger.read()).entries;
  for (const actionId of ['specialists.manage', 'channels.create'] as const) {
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
      actionId: 'channels.manage-specialists',
      autonomy: 'do',
      allowed: false,
    }),
  ).toBe(true);
  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.state.channels).toEqual([
    expect.objectContaining({
      title: 'Vanta SOC 2 operations',
      specialistIds: [],
    }),
  ]);
  expect(Reflect.get(storedState(snapshot), 'settings')).toMatchObject({
    specialistId: null,
    channelId: null,
  });
  expect(snapshot.state.storage[0]?.revision).toBe(1);
});
