import {
  expect,
  test,
} from '@theaiplatform/miniapp-sdk/testing/rstest';
import {
  expectExactProvenance,
  hasHostAuthorizationDecision,
  openResearch,
  storedLedger,
} from './personal-health-ledger-test-support';

test('preserves the connected specialist but never starts a denied turn', async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    profileId: 'personal-health-ledger-desktop-specialists-invoke-denied',
    matrixEntryId: 'personal-health-ledger-desktop-specialists-invoke-denied',
    permissionScenario: 'deny:specialists.invoke',
    seed: 6935,
    theme: 'dark',
  });

  await openResearch(surface);
  await expect(surface.getByText('Connected', { exact: true })).toBeVisible();
  await surface
    .getByRole('checkbox', { name: /Approve this private-context transfer/u })
    .click();
  await surface
    .getByRole('button', { name: 'Run Find Current Evidence', exact: true })
    .click();
  await expect(
    surface.getByText('Specialist Operation Failed', { exact: true }),
  ).toBeVisible();
  await expect(surface.getByRole('alert')).toContainText(
    /host action permission is not granted/iu,
  );

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasHostAuthorizationDecision(ledger.entries, {
      actionId: 'specialists.invoke',
      autonomy: 'do',
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
  expect(Reflect.get(storedLedger(snapshot), 'specialistBinding')).toEqual({
    channelId: 'health-fixture-channel',
    specialistId: 'personal-health-researcher',
    connectedAt: '2026-07-24T12:00:00.000Z',
  });
  expect(Reflect.get(storedLedger(snapshot), 'specialistRuns')).toEqual([]);
  expect(snapshot.state.storage[0]?.revision).toBe(1);
  expect(await tap.fixture.http.requests()).toEqual({
    dropped: 0,
    requests: [],
  });
});
