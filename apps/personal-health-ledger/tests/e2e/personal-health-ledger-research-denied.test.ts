import {
  expect,
  test,
} from '@theaiplatform/miniapp-sdk/testing/rstest';
import {
  expectExactProvenance,
  hasHostAuthorizationDecision,
  openResearch,
} from './personal-health-ledger-test-support';

test('blocks denied research before network or specialist effects', async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    profileId: 'personal-health-ledger-desktop-research-denied',
    matrixEntryId: 'personal-health-ledger-desktop-research-denied',
    permissionScenario: 'deny:health-ledger.research',
    seed: 6938,
    theme: 'dark',
  });

  const initialSnapshot = await tap.fixture.snapshot();
  await openResearch(surface);
  await expect(
    surface.getByRole('heading', {
      name: 'Research Access Unavailable',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    surface.getByRole('button', {
      name: 'Connect Health Specialist',
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    surface.getByRole('button', {
      name: 'Refresh Official Sources',
      exact: true,
    }),
  ).toBeDisabled();

  expect(await tap.fixture.http.requests()).toEqual({
    dropped: 0,
    requests: [],
  });
  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
  expect(
    hasHostAuthorizationDecision(ledger.entries, {
      actionId: 'health-ledger.research',
      autonomy: 'plan',
      allowed: false,
    }),
  ).toBe(true);
  expect(
    ledger.entries.some(
      entry =>
        (entry.kind === 'native' && entry.operation === 'http.request') ||
        (entry.kind === 'platform' && entry.operation === 'storage.set') ||
        (entry.kind === 'host-action' &&
          (entry.operation.startsWith('channels.') ||
            entry.operation.startsWith('specialists.'))),
    ),
  ).toBe(false);

  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.state.channels).toEqual(initialSnapshot.state.channels);
  expect(snapshot.state.specialists).toEqual(initialSnapshot.state.specialists);
  expect(snapshot.state.storage[0]?.revision).toBe(1);
});
