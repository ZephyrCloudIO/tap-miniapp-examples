import {
  expect,
  test,
} from '@theaiplatform/miniapp-sdk/testing/rstest';
import {
  expectExactProvenance,
  hasHostAuthorizationDecision,
} from './personal-health-ledger-test-support';

test('disables every denied export before download or VFS effects', async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    profileId: 'personal-health-ledger-desktop-export-denied',
    matrixEntryId: 'personal-health-ledger-desktop-export-denied',
    permissionScenario: 'deny:health-ledger.export',
    seed: 6939,
    theme: 'dark',
  });

  await surface.getByRole('tab', { name: 'Share', exact: true }).click();
  await expect(
    surface.getByText(
      'TAP has not granted this package authority to export the ledger.',
      { exact: true },
    ),
  ).toBeVisible();
  for (const name of [
    'Printable HTML',
    'Plain Text',
    'Administration CSV',
    'Complete Archive',
    'Save to TAP VFS',
  ]) {
    await expect(
      surface.getByRole('button', { name: new RegExp(name, 'u') }),
    ).toBeDisabled();
  }

  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
  expect(
    hasHostAuthorizationDecision(ledger.entries, {
      actionId: 'health-ledger.export',
      autonomy: 'do',
      allowed: false,
    }),
  ).toBe(true);
  expect(
    ledger.entries.some(
      entry =>
        entry.kind === 'host-action' &&
        entry.operation === 'platform.vfs.write-file',
    ),
  ).toBe(false);

  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.state.vfsFiles).toEqual([]);
  expect(snapshot.state.storage[0]?.revision).toBe(1);
});
