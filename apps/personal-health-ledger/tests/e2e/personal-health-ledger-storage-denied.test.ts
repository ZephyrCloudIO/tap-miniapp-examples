import {
  expect,
  test,
} from '@theaiplatform/miniapp-sdk/testing/rstest';
import {
  PACKAGE_ID,
  expectExactProvenance,
  hasPlatformAuthorizationDecision,
} from './personal-health-ledger-test-support';

test('fails closed after projected authority is synthetically revoked', async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    profileId: 'personal-health-ledger-desktop-post-projection-revoked',
    matrixEntryId: 'personal-health-ledger-desktop-storage-denied',
    permissionScenario: 'synthetic:post-projection-all-denied',
    seed: 6930,
    theme: 'dark',
  });

  await expect(
    surface.getByRole('heading', {
      name: 'Create Your Private Ledger',
      exact: true,
    }),
  ).toBeVisible();
  await expect(surface.getByRole('alert')).toContainText(
    /did not grant this platform action/iu,
  );

  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
  expect(
    hasPlatformAuthorizationDecision(ledger.entries, {
      action: 'tap.platform.storage.get',
      actionId: 'storage.read',
      autonomy: 'listen',
      allowed: false,
    }),
  ).toBe(true);
  expect(
    ledger.entries.some(
      entry =>
        entry.kind === 'platform' &&
        ['storage.get', 'storage.set', 'storage.delete'].includes(
          entry.operation,
        ),
    ),
  ).toBe(false);

  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.state.storage).toEqual([
    expect.objectContaining({
      packageId: PACKAGE_ID,
      namespace: 'personal-health-ledger',
      key: 'private/ledger-v1',
      revision: 1,
    }),
  ]);
});
