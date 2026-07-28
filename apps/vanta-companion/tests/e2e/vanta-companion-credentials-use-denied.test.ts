import { expect, test } from '@theaiplatform/miniapp-sdk/testing/rstest';
import {
  expectExactProvenance,
  hasHostAuthorizationDecision,
  hasPlatformAuthorizationDecision,
  openVantaApi,
  requireSingleCredentialAlias,
  VANTA_CREDENTIAL_DISPLAY_NAME,
} from './vanta-companion-test-support';

test('denies the selected Vanta credential before native HTTP', async ({
  surface,
  tap,
}) => {
  const credentialAlias = requireSingleCredentialAlias(tap);
  expectExactProvenance(tap, {
    profileId: 'vanta-companion-desktop-credentials-use-denied',
    matrixEntryId: 'vanta-companion-desktop-credentials-use-denied',
    permissionScenario: 'deny:credentials.use',
    seed: 6941,
    theme: 'dark',
    allowedNetworkOrigins: ['https://api.vanta.com'],
    credentialAliases: [credentialAlias],
  });
  await openVantaApi(surface);
  await surface
    .getByRole('button', { name: 'Load credentials', exact: true })
    .click();
  await expect(
    surface.getByText(
      'Found 1 host-managed HTTP credential',
      { exact: true },
    ),
  ).toBeVisible();

  const credential = surface.getByLabel('Host credential');
  await expect(credential).toHaveValue(credentialAlias);
  await expect(
    credential.getByRole('option', {
      name: `${VANTA_CREDENTIAL_DISPLAY_NAME} · http_bearer`,
      exact: true,
    }),
  ).toHaveAttribute('value', credentialAlias);
  await surface
    .getByRole('button', { name: 'Execute request', exact: true })
    .click();
  await expect(surface.getByRole('alert')).toContainText(
    /Couldn’t complete that action.*platform permission is not granted/iu,
  );

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
    hasHostAuthorizationDecision(ledger.entries, {
      actionId: 'credentials.use',
      autonomy: 'do',
      allowed: false,
    }),
  ).toBe(true);
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
        entry.kind === 'native' && entry.operation === 'http.request',
    ),
  ).toBe(false);
  expect(await tap.fixture.http.requests()).toEqual({
    dropped: 0,
    requests: [],
  });
  await expect(
    surface.getByText('No API response', { exact: true }),
  ).toBeVisible();
});
