import { expect, test } from '@theaiplatform/miniapp-sdk/testing/rstest';
import {
  expectExactProvenance,
  hasAnyHostAuthorizationDecision,
  hasHostAuthorizationDecision,
  hasPlatformAuthorizationDecision,
  openVantaApi,
  requireSingleCredentialAlias,
} from './vanta-companion-test-support';

test('denies Vanta network authority before native HTTP and persistence', async ({
  surface,
  tap,
}) => {
  const credentialAlias = requireSingleCredentialAlias(tap);
  expectExactProvenance(tap, {
    profileId: 'vanta-companion-desktop-http-denied',
    matrixEntryId: 'vanta-companion-desktop-http-denied',
    permissionScenario: 'http-denied',
    seed: 6942,
    theme: 'dark',
    allowedNetworkOrigins: ['https://api.vanta.com'],
    credentialAliases: [credentialAlias],
  });
  await openVantaApi(surface);
  await surface
    .getByRole('button', { name: 'Load credentials', exact: true })
    .click();
  await expect(
    surface.getByText('Found 1 host-managed HTTP credential', { exact: true }),
  ).toBeVisible();

  await surface
    .getByRole('button', { name: 'Execute request', exact: true })
    .click();
  await expect(surface.getByRole('alert')).toContainText(
    /Couldn’t complete that action.*platform permission is not granted/iu,
  );
  await expect(
    surface.getByText('No API response', { exact: true }),
  ).toBeVisible();

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasHostAuthorizationDecision(ledger.entries, {
      actionId: 'vanta-companion.analyze',
      autonomy: 'plan',
      allowed: true,
    }),
  ).toBe(true);
  expect(
    hasPlatformAuthorizationDecision(ledger.entries, {
      action: 'tap.platform.credentials.list-http',
      actionId: 'credentials.read',
      autonomy: 'listen',
      allowed: true,
    }),
  ).toBe(true);
  expect(
    hasPlatformAuthorizationDecision(ledger.entries, {
      action: 'tap.platform.http.request',
      actionId: 'network.request',
      autonomy: 'do',
      allowed: false,
    }),
  ).toBe(true);
  expect(hasAnyHostAuthorizationDecision(ledger.entries, 'credentials.use')).toBe(
    false,
  );
  expect(
    ledger.entries.some(
      entry =>
        entry.kind === 'native' && entry.operation === 'http.request',
    ),
  ).toBe(false);
  expect(await tap.fixture.http.requests()).toEqual({
    dropped: 0,
    requests: [],
  });

  const snapshot = await tap.fixture.snapshot();
  expect(
    snapshot.state.storage.find(
      entry =>
        entry.namespace === 'vanta-companion' &&
        entry.key === 'workspace/state-v3',
    )?.revision,
  ).toBe(1);
});
