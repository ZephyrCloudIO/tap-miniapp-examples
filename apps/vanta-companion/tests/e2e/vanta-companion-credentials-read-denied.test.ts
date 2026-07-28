import { expect, test } from '@theaiplatform/miniapp-sdk/testing/rstest';
import {
  expectExactProvenance,
  hasHostAuthorizationDecision,
  hasPlatformAuthorizationDecision,
  openVantaApi,
} from './vanta-companion-test-support';

test('denies credential metadata without issuing an HTTP request', async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    profileId: 'vanta-companion-desktop-credentials-read-denied',
    matrixEntryId: 'vanta-companion-desktop-credentials-read-denied',
    permissionScenario: 'deny:credentials.read',
    seed: 6937,
    theme: 'dark',
  });
  await openVantaApi(surface);
  await surface
    .getByRole('button', { name: 'Load credentials', exact: true })
    .click();
  await expect(surface.getByRole('alert')).toContainText(
    /did not grant this platform action/iu,
  );
  expect(
    hasHostAuthorizationDecision(
      (await tap.fixture.ledger.read()).entries,
      {
        actionId: 'vanta-companion.analyze',
        autonomy: 'plan',
        allowed: true,
      },
    ),
  ).toBe(true);
  expect(
    hasPlatformAuthorizationDecision(
      (await tap.fixture.ledger.read()).entries,
      {
        action: 'tap.platform.credentials.list-http',
        actionId: 'credentials.read',
        autonomy: 'listen',
        allowed: false,
      },
    ),
  ).toBe(true);
  expect(await tap.fixture.http.requests()).toEqual({
    dropped: 0,
    requests: [],
  });
});
