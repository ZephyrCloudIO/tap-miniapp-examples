import { expect, test } from '@theaiplatform/miniapp-sdk/testing/rstest';
import {
  expectExactProvenance,
  hasHostAuthorizationDecision,
  installCompanion,
  storedState,
} from './vanta-companion-test-support';

test('denies specialist installation before creating a channel', async ({
  surface,
  tap,
}) => {
  const before = await tap.fixture.snapshot();
  expectExactProvenance(tap, {
    profileId: 'vanta-companion-desktop-specialists-manage-denied',
    matrixEntryId: 'vanta-companion-desktop-specialists-manage-denied',
    permissionScenario: 'deny:specialists.manage',
    seed: 6931,
    theme: 'dark',
  });
  await installCompanion(surface);
  await expect(surface.getByRole('alert')).toContainText(
    /host action permission is not granted/iu,
  );

  const entries = (await tap.fixture.ledger.read()).entries;
  expect(
    hasHostAuthorizationDecision(entries, {
      actionId: 'vanta-companion.coordinate',
      autonomy: 'do',
      allowed: true,
    }),
  ).toBe(true);
  expect(
    hasHostAuthorizationDecision(entries, {
      actionId: 'specialists.manage',
      autonomy: 'do',
      allowed: false,
    }),
  ).toBe(true);
  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.state.specialists).toEqual(before.state.specialists);
  expect(snapshot.state.channels).toEqual(before.state.channels);
  expect(Reflect.get(storedState(snapshot), 'settings')).toMatchObject({
    specialistId: null,
    channelId: null,
  });
  expect(snapshot.state.storage[0]?.revision).toBe(1);
});
