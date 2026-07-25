import { expect, test } from '@theaiplatform/miniapp-sdk/testing/rstest';
import {
  expectExactProvenance,
  hasHostAuthorizationDecision,
  storedState,
} from './vanta-companion-test-support';

test('preserves connected state without recording a denied specialist turn', async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    profileId: 'vanta-companion-desktop-specialists-invoke-denied',
    matrixEntryId: 'vanta-companion-desktop-specialists-invoke-denied',
    permissionScenario: 'deny:specialists.invoke',
    seed: 6936,
    theme: 'dark',
  });
  await expect(
    surface.getByText('Specialist installed', { exact: true }),
  ).toBeVisible();
  await surface
    .getByRole('button', { name: 'Run weekly briefing', exact: true })
    .click();
  await expect(surface.getByRole('alert')).toContainText(
    /host action permission is not granted/iu,
  );

  expect(
    hasHostAuthorizationDecision(
      (await tap.fixture.ledger.read()).entries,
      {
        actionId: 'specialists.invoke',
        autonomy: 'do',
        allowed: false,
      },
    ),
  ).toBe(true);
  const snapshot = await tap.fixture.snapshot();
  expect(Reflect.get(storedState(snapshot), 'analyses')).toEqual([]);
  expect(snapshot.state.storage[0]?.revision).toBe(1);
});
