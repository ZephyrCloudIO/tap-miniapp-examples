import {
  expect,
  test,
} from '@theaiplatform/miniapp-sdk/testing/rstest';
import {
  expectExactProvenance,
  hasHostAuthorizationDecision,
} from './personal-health-ledger-test-support';

test('keeps denied clinician exports out of the conversation VFS', async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    profileId: 'personal-health-ledger-desktop-vfs-write-denied',
    matrixEntryId: 'personal-health-ledger-desktop-vfs-write-denied',
    permissionScenario: 'deny:vfs.write',
    seed: 6936,
    theme: 'dark',
  });

  await surface.getByRole('tab', { name: 'Share', exact: true }).click();
  await surface
    .getByRole('button', { name: /Save to TAP VFS/u })
    .click();
  await expect(
    surface.getByRole('status').filter({
      hasText: 'The miniapp host action permission is not granted.',
    }),
  ).toBeVisible();

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasHostAuthorizationDecision(ledger.entries, {
      actionId: 'vfs.write',
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
