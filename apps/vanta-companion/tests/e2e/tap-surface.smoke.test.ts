import { expect, test } from '@theaiplatform/miniapp-sdk/testing/rstest';
import {
  FIXED_NOW,
  FIXED_NOW_GREETING,
  PACKAGE_ID,
  packageEventLocalName,
  SDK_VERSION,
  SEMVER,
  SHA256,
  SURFACE_ID,
} from './vanta-companion-test-support';

test('remounts the exact declared TAP cell with reproducible provenance', async ({
  surface,
  tap,
}) => {
  expect(tap.packageId).toBe(PACKAGE_ID);
  expect(tap.surfaceId).toBe(SURFACE_ID);
  expect(tap.target).toBe('desktop');
  expect(tap.profileId).toBe('vanta-companion-desktop');
  expect(tap.matrixEntryId).toBe('vanta-companion-desktop-positive');
  expect(tap.environment.fixedNow).toBe(FIXED_NOW);
  expect(tap.adapterVersion).toBe(SDK_VERSION);
  expect(tap.hostVersion).toMatch(SEMVER);
  expect(tap.hostContractVersion).toBe('1');
  expect(tap.runnerName).toBe('rstest');
  expect(tap.runnerVersion).toBe('0.11.5');
  for (const digest of [
    tap.sourceDigest,
    tap.testBundleDigest,
    tap.descriptorDigest,
    tap.fixtureDigest,
    tap.policyDigest,
  ]) {
    expect(digest).toMatch(SHA256);
  }

  await tap.control.remountSurface();
  const root = surface.locator('#tap-root');
  await expect(root).toBeVisible();
  await expect(root.locator(':scope > *').first()).toBeAttached();
  await expect(surface.locator('#tap-error')).toBeHidden();
  await expect(
    surface.getByRole('heading', {
      level: 1,
      name: FIXED_NOW_GREETING,
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      (await tap.fixture.ledger.read()).entries.filter(
        entry =>
          packageEventLocalName(entry) ===
          'vanta-companion.surface.mounted',
      ).length,
    )
    .toBeGreaterThanOrEqual(2);
});
