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

test('creates no specialist membership or binding when channel join is denied', async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    profileId: 'personal-health-ledger-desktop-channels-manage-denied',
    matrixEntryId: 'personal-health-ledger-desktop-channels-manage-denied',
    permissionScenario: 'deny:channels.manage-specialists',
    seed: 6934,
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
      actionId: 'channels.create',
      autonomy: 'do',
      allowed: true,
    }),
  ).toBe(true);
  expect(
    hasHostAuthorizationDecision(ledger.entries, {
      actionId: 'channels.manage-specialists',
      autonomy: 'do',
      allowed: false,
    }),
  ).toBe(true);
  expect(
    ledger.entries.some(
      entry =>
        entry.kind === 'host-action' &&
        entry.operation === 'platform.specialist.join',
    ),
  ).toBe(false);

  const snapshot = await tap.fixture.snapshot();
  expect(
    snapshot.state.channels.find(
      channel => channel.title === 'Personal Health Ledger research',
    ),
  ).toMatchObject({
    roomId: 'tap-fixture-channel-1',
    specialistIds: [],
  });
  expect(Reflect.get(storedLedger(snapshot), 'specialistBinding')).toBeNull();
  expect(snapshot.state.storage[0]?.revision).toBe(1);
});
