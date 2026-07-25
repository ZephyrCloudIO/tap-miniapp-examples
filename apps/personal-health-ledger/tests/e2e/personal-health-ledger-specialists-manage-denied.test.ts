import {
  expect,
  test,
} from '@theaiplatform/miniapp-sdk/testing/rstest';
import {
  connectHealthSpecialist,
  expectExactProvenance,
  hasHostAuthorizationDecision,
  storedLedger,
} from './personal-health-ledger-test-support';

test('denies managed-specialist installation before any channel side effect', async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    profileId: 'personal-health-ledger-desktop-specialists-manage-denied',
    matrixEntryId:
      'personal-health-ledger-desktop-specialists-manage-denied',
    permissionScenario: 'deny:specialists.manage',
    seed: 6932,
    theme: 'dark',
  });

  await connectHealthSpecialist(surface);
  await expect(
    surface.getByText('Specialist Operation Failed', { exact: true }),
  ).toBeVisible();
  await expect(surface.getByRole('alert')).toContainText(
    /host action permission is not granted/iu,
  );

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasHostAuthorizationDecision(ledger.entries, {
      actionId: 'specialists.manage',
      autonomy: 'do',
      allowed: false,
    }),
  ).toBe(true);
  expect(
    ledger.entries.some(
      entry =>
        entry.kind === 'host-action' &&
        (entry.operation === 'channels.create' ||
          entry.operation.startsWith('platform.specialist.')),
    ),
  ).toBe(false);

  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.state.specialists).toEqual([]);
  expect(
    snapshot.state.channels.some(
      channel => channel.title === 'Personal Health Ledger research',
    ),
  ).toBe(false);
  expect(Reflect.get(storedLedger(snapshot), 'specialistBinding')).toBeNull();
});
