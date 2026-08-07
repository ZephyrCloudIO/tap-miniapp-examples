import {
  expect,
  type TapMiniappTestFixture,
} from "@theaiplatform/miniapp-sdk/testing/rstest";

export const PACKAGE_ID = "tap_pkg_examples_kart_royale_0001";
export const SURFACE_ID = "kart-royale";
export const TARGET = "desktop";
export const STORAGE_NAMESPACE = "kart-royale";
export const FIXTURE_USER_ID = "tap-fixture-user-v1";
export const CONTROL_PREFS_KEY = `users/${FIXTURE_USER_ID}/control-prefs`;
export const FIXED_NOW = "2026-08-05T12:00:00Z";
export const SDK_VERSION = "0.5.3";
export const SHA256 = /^[a-f0-9]{64}$/u;

export type KartRoyaleRunKind = "positive" | "post-projection-revoked" | "http-denied";

export function expectExactProvenance(
  tap: TapMiniappTestFixture,
  kind: KartRoyaleRunKind,
): void {
  const positive = kind === "positive";
  const httpDenied = kind === "http-denied";
  expect({
    matrixEntryId: tap.matrixEntryId,
    packageId: tap.packageId,
    profileId: tap.profileId,
    surfaceId: tap.surfaceId,
    target: tap.target,
    permissionScenario: tap.permissionScenario,
    seed: tap.seed,
    adapterVersion: tap.adapterVersion,
  }).toEqual({
    matrixEntryId: positive
      ? "kart-royale-desktop-positive"
      : httpDenied
        ? "kart-royale-desktop-http-denied"
        : "kart-royale-desktop-storage-denied",
    packageId: PACKAGE_ID,
    profileId: positive
      ? "kart-royale-desktop"
      : httpDenied
        ? "kart-royale-desktop-http-denied"
        : "kart-royale-desktop-post-projection-revoked",
    surfaceId: SURFACE_ID,
    target: TARGET,
    permissionScenario: positive ? "default" : httpDenied ? "http-denied" : "all-denied",
    seed: positive ? 7291 : httpDenied ? 7293 : 7292,
    adapterVersion: SDK_VERSION,
  });
  expect(tap.environment).toEqual({
    viewport: { width: 1280, height: 720 },
    locale: "en-US",
    timezone: "UTC",
    theme: positive || httpDenied ? "light" : "dark",
    reducedMotion: true,
    seed: positive ? 7291 : httpDenied ? 7293 : 7292,
    fixedNow: FIXED_NOW,
  });
  expect(tap.sourceDigest).toMatch(SHA256);
  expect(tap.testBundleDigest).toMatch(SHA256);
  expect(tap.descriptorDigest).toMatch(SHA256);
  expect(tap.policyDigest).toMatch(SHA256);
  expect(tap.fixtureDigest).toMatch(SHA256);
}
