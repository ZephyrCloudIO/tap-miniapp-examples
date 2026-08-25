import {
  expect,
  test,
} from '@theaiplatform/miniapp-sdk/testing/rstest';

const SHA256 = /^[a-f0-9]{64}$/u;

test('mounts TAP Email and opens the cloud mailbox through governed HTTP', async ({
  surface,
  tap,
}) => {
  expect({
    matrixEntryId: tap.matrixEntryId,
    packageId: tap.packageId,
    profileId: tap.profileId,
    surfaceId: tap.surfaceId,
    target: tap.target,
  }).toEqual({
    matrixEntryId: 'tap-email-desktop-positive',
    packageId: 'tap_pkg_examples_tap_email_0001',
    profileId: 'tap-email-desktop',
    surfaceId: 'tap-email',
    target: 'desktop',
  });
  expect(tap.descriptorDigest).toMatch(SHA256);
  expect(tap.policyDigest).toMatch(SHA256);
  expect(tap.sourceDigest).toMatch(SHA256);
  expect(tap.testBundleDigest).toMatch(SHA256);
  expect(tap.fixtureDigest).toMatch(SHA256);

  await tap.control.reset();
  await expect(surface.locator('#tap-error')).toBeHidden();
  await expect(
    surface.getByRole('heading', { level: 1, name: 'Inbox', exact: true }),
  ).toBeVisible();
  await expect(
    surface.getByText('Google account required', { exact: true }),
  ).toBeVisible();
  await expect(
    surface.getByText(
      'Connect Google to start a private, account-scoped mailbox.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    surface.getByRole('button', { name: 'Connect Google', exact: true }).first(),
  ).toBeVisible();

  await expect
    .poll(async () => {
      const snapshot = await tap.fixture.snapshot();
      return snapshot.state.storage.some(
        entry =>
          entry.namespace === 'tap-email' && entry.key === 'operational/v1',
      );
    })
    .toBe(true);
});
