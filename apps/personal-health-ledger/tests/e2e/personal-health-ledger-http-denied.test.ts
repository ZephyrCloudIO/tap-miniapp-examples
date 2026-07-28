import {
  expect,
  test,
} from '@theaiplatform/miniapp-sdk/testing/rstest';
import {
  expectExactProvenance,
  hasPlatformAuthorizationDecision,
  openResearch,
} from './personal-health-ledger-test-support';

test('denies all three official origins before any native request or write', async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    profileId: 'personal-health-ledger-desktop-http-denied',
    matrixEntryId: 'personal-health-ledger-desktop-http-denied',
    permissionScenario: 'http-denied',
    seed: 6931,
    theme: 'dark',
  });

  await openResearch(surface);
  await surface
    .getByRole('checkbox', { name: /Approve this public-source query/u })
    .click();
  await surface
    .getByRole('button', { name: 'Refresh Official Sources', exact: true })
    .click();
  await expect(
    surface.getByRole('heading', {
      name: 'Source Refresh Failed',
      exact: true,
    }),
  ).toBeVisible();
  await expect(surface.getByRole('alert')).toContainText(
    /The Miniapp Test run did not allow this network origin/iu,
  );

  expect(await tap.fixture.http.requests()).toEqual({
    dropped: 0,
    requests: [],
  });
  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
  expect(
    hasPlatformAuthorizationDecision(ledger.entries, {
      action: 'tap.platform.http.request',
      actionId: 'network.request',
      autonomy: 'do',
      allowed: true,
    }),
  ).toBe(true);
  expect(
    ledger.entries.some(
      entry =>
        (entry.kind === 'native' && entry.operation === 'http.request') ||
        (entry.kind === 'platform' && entry.operation === 'storage.set'),
    ),
  ).toBe(false);

  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.state.httpScripts).toHaveLength(4);
  expect(snapshot.state.httpScripts.every(script => script.repeat === 1)).toBe(
    true,
  );
  expect(snapshot.state.storage[0]?.revision).toBe(1);
});
