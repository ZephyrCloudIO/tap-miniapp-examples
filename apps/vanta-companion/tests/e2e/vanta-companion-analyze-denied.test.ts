import { expect, test } from '@theaiplatform/miniapp-sdk/testing/rstest';
import {
  expectExactProvenance,
  hasAnyHostAuthorizationDecision,
  hasHostAuthorizationDecision,
  storedState,
} from './vanta-companion-test-support';

test('denies product analysis before invoking the connected specialist', async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    profileId: 'vanta-companion-desktop-analyze-denied',
    matrixEntryId: 'vanta-companion-desktop-analyze-denied',
    permissionScenario: 'deny:vanta-companion.analyze',
    seed: 6939,
    theme: 'dark',
  });
  await expect(
    surface.getByText('Specialist joined', { exact: true }),
  ).toBeVisible();

  await surface
    .getByRole('button', { name: 'Run weekly briefing', exact: true })
    .click();
  await expect(surface.getByRole('alert')).toContainText(
    /does not allow this miniapp to analyze Vanta data/iu,
  );
  const entries = (await tap.fixture.ledger.read()).entries;
  expect(
    hasHostAuthorizationDecision(entries, {
      actionId: 'vanta-companion.analyze',
      autonomy: 'plan',
      allowed: false,
    }),
  ).toBe(true);
  expect(
    hasAnyHostAuthorizationDecision(entries, 'specialists.invoke'),
  ).toBe(false);

  const snapshot = await tap.fixture.snapshot();
  expect(Reflect.get(storedState(snapshot), 'analyses')).toEqual([]);
  expect(snapshot.state.storage[0]?.revision).toBe(1);
});
