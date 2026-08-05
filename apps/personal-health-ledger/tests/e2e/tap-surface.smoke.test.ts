import { expect, test } from '@theaiplatform/miniapp-sdk/testing/rstest';

const PACKAGE_ID = "tap_pkg_examples_personal_health_ledger_0001";
const SDK_VERSION = "0.5.2";
const SURFACE_TARGET_CELLS = new Set(["personal-health-ledger\u0000desktop"]);
const PROFILE_IDS = new Set(["personal-health-ledger-desktop"]);
const MATRIX_ENTRY_IDS = new Set(["personal-health-ledger-desktop-positive"]);
const SHA256 = /^[a-f0-9]{64}$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

test('mounts the exact declared TAP cell with reproducible provenance', async ({ surface, tap }) => {
  expect(tap.packageId).toBe(PACKAGE_ID);
  expect(SURFACE_TARGET_CELLS.has(`${tap.surfaceId}\0${tap.target}`)).toBe(true);
  expect(PROFILE_IDS.has(tap.profileId)).toBe(true);
  expect(MATRIX_ENTRY_IDS.has(tap.matrixEntryId)).toBe(true);
  expect(tap.seed).toBe(tap.environment.seed);
  expect(tap.environment.fixedNow).toBe("2026-07-24T12:00:00Z");
  expect(tap.adapterVersion).toBe(SDK_VERSION);
  expect(tap.hostVersion).toMatch(SEMVER);
  expect(tap.hostContractVersion).toMatch(/^\d+$/u);
  expect(tap.runnerName).toBe('rstest');
  expect(tap.runnerVersion).toMatch(SEMVER);
  expect(tap.sourceDigest).toMatch(SHA256);
  expect(tap.testBundleDigest).toMatch(SHA256);
  expect(tap.descriptorDigest).toMatch(SHA256);
  expect(tap.policyDigest).toMatch(SHA256);
  if (tap.mode === 'surface') expect(tap.fixtureDigest).toMatch(SHA256);
  else expect(tap.fixtureDigest).toBeUndefined();

  await tap.control.reset();
  const root = surface.locator('#tap-root');
  await expect(root).toBeVisible();
  await expect(root.locator(':scope > *').first()).toBeAttached();
  await expect(surface.locator('#tap-error')).toBeHidden();
  await expect(
    surface.getByRole('heading', { level: 1, name: 'Today', exact: true }),
  ).toBeVisible();
  await expect(
    surface.getByText('Test Lab Ledger', { exact: true }),
  ).toBeVisible();
});
