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

test('keeps a denied private research channel out of the host realm', async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    profileId: 'personal-health-ledger-desktop-channels-create-denied',
    matrixEntryId: 'personal-health-ledger-desktop-channels-create-denied',
    permissionScenario: 'deny:channels.create',
    seed: 6933,
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
      allowed: true,
    }),
  ).toBe(true);
  expect(
    hasHostAuthorizationDecision(ledger.entries, {
      actionId: 'channels.create',
      autonomy: 'do',
      allowed: false,
    }),
  ).toBe(true);
  expect(
    ledger.entries.some(
      entry =>
        entry.kind === 'host-action' && entry.operation === 'channels.create',
    ),
  ).toBe(false);

  const snapshot = await tap.fixture.snapshot();
  expect(
    snapshot.state.specialists.some(
      specialist => specialist.id === 'personal-health-researcher',
    ),
  ).toBe(true);
  expect(
    snapshot.state.channels.some(
      channel => channel.title === 'Personal Health Ledger research',
    ),
  ).toBe(false);
  expect(Reflect.get(storedLedger(snapshot), 'specialistBinding')).toBeNull();
});
