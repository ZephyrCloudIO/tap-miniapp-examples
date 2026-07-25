import { expect, test } from '@theaiplatform/miniapp-sdk/testing/rstest';
import {
  expectExactProvenance,
  hasAnyHostAuthorizationDecision,
  hasHostAuthorizationDecision,
  installCompanion,
  storedState,
} from './vanta-companion-test-support';

test('denies product coordination before any host side effect', async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    profileId: 'vanta-companion-desktop-coordinate-denied',
    matrixEntryId: 'vanta-companion-desktop-coordinate-denied',
    permissionScenario: 'deny:vanta-companion.coordinate',
    seed: 6938,
    theme: 'dark',
  });

  await installCompanion(surface);
  await expect(surface.getByRole('alert')).toContainText(
    /does not allow this miniapp to coordinate Vanta work/iu,
  );
  const entries = (await tap.fixture.ledger.read()).entries;
  expect(
    hasHostAuthorizationDecision(entries, {
      actionId: 'vanta-companion.coordinate',
      autonomy: 'do',
      allowed: false,
    }),
  ).toBe(true);
  for (const actionId of [
    'specialists.manage',
    'channels.create',
    'channels.manage-specialists',
  ]) {
    expect(hasAnyHostAuthorizationDecision(entries, actionId)).toBe(false);
  }

  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.state.specialists).toEqual([]);
  expect(snapshot.state.channels).toEqual([]);
  expect(Reflect.get(storedState(snapshot), 'settings')).toMatchObject({
    specialistId: null,
    channelId: null,
  });
  expect(snapshot.state.storage[0]?.revision).toBe(1);
});
