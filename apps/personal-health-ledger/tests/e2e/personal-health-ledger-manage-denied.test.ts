import {
  expect,
  test,
} from '@theaiplatform/miniapp-sdk/testing/rstest';
import {
  expectExactProvenance,
  hasHostAuthorizationDecision,
} from './personal-health-ledger-test-support';

test('keeps a denied ledger manager in an effect-free view-only state', async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    profileId: 'personal-health-ledger-desktop-manage-denied',
    matrixEntryId: 'personal-health-ledger-desktop-manage-denied',
    permissionScenario: 'deny:health-ledger.manage',
    seed: 6937,
    theme: 'dark',
  });

  await expect(
    surface.getByRole('heading', {
      level: 1,
      name: 'Today',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    surface.getByRole('button', { name: 'Quick Add', exact: true }),
  ).toBeDisabled();
  await expect(
    surface.getByText('View-only authority', { exact: true }),
  ).toBeVisible();

  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
  expect(
    hasHostAuthorizationDecision(ledger.entries, {
      actionId: 'health-ledger.manage',
      autonomy: 'plan',
      allowed: false,
    }),
  ).toBe(true);
  expect(
    ledger.entries.some(
      entry =>
        entry.kind === 'platform' && entry.operation === 'storage.set',
    ),
  ).toBe(false);

  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.state.storage[0]?.revision).toBe(1);
});
