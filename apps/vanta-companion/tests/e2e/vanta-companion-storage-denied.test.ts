import { expect, test } from '@theaiplatform/miniapp-sdk/testing/rstest';
import {
  PACKAGE_ID,
  expectExactProvenance,
  hasPlatformAuthorizationDecision,
} from './vanta-companion-test-support';

test('fails closed after an already-projected surface loses storage authority', async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    profileId: 'vanta-companion-desktop-post-projection-revoked',
    matrixEntryId: 'vanta-companion-desktop-storage-denied',
    permissionScenario: 'synthetic:post-projection-all-denied',
    seed: 6930,
    theme: 'dark',
  });
  await expect(
    surface.getByRole('heading', {
      name: /Compliance work,\s+connected to the source\./u,
    }),
  ).toBeVisible();
  await expect(surface.getByRole('alert')).toContainText(
    /did not grant this platform action/iu,
  );

  const ledger = await tap.fixture.ledger.read();
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
        ['storage.get', 'storage.set', 'storage.delete'].includes(entry.operation),
    ),
  ).toBe(false);
  expect((await tap.fixture.snapshot()).state.storage).toEqual([
    expect.objectContaining({
      packageId: PACKAGE_ID,
      namespace: 'vanta-companion',
      key: 'workspace/state-v3',
      revision: 1,
    }),
  ]);
});
