import {
  expect,
  type TapMiniappTestFixture,
  type TapMiniappTestFixtureLedger,
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
export const RACE_SERVER_ORIGIN =
  "https://tap-kart-royale-server-production.zephyr-cloud-app-dev.workers.dev";
export const ROOMS_URL =
  `${RACE_SERVER_ORIGIN}/channels/tap-fixture-channel-v1/rooms`;

export type KartRoyaleRunKind =
  | "positive"
  | "post-projection-revoked"
  | "http-denied"
  | "credentials-use-denied"
  | "presence-denied";

export function expectExactProvenance(
  tap: TapMiniappTestFixture,
  kind: KartRoyaleRunKind,
): void {
  const expected = {
    positive: {
      matrixEntryId: "kart-royale-desktop-positive",
      profileId: "kart-royale-desktop",
      permissionScenario: "default",
      seed: 7291,
      theme: "light",
      networkEnabled: true,
    },
    "post-projection-revoked": {
      matrixEntryId: "kart-royale-desktop-storage-denied",
      profileId: "kart-royale-desktop-post-projection-revoked",
      permissionScenario: "all-denied",
      seed: 7292,
      theme: "dark",
      networkEnabled: false,
    },
    "http-denied": {
      matrixEntryId: "kart-royale-desktop-http-denied",
      profileId: "kart-royale-desktop-http-denied",
      permissionScenario: "http-denied",
      seed: 7293,
      theme: "light",
      networkEnabled: true,
    },
    "credentials-use-denied": {
      matrixEntryId: "kart-royale-desktop-credentials-use-denied",
      profileId: "kart-royale-desktop-credentials-use-denied",
      permissionScenario: "deny:credentials.use",
      seed: 7294,
      theme: "dark",
      networkEnabled: true,
    },
    "presence-denied": {
      matrixEntryId: "kart-royale-desktop-presence-denied",
      profileId: "kart-royale-desktop-presence-denied",
      permissionScenario: "deny:presence.write",
      seed: 7295,
      theme: "dark",
      networkEnabled: false,
    },
  }[kind];
  expect({
    allowedNetworkOrigins: tap.allowedNetworkOrigins,
    credentialAliases: tap.credentialAliases,
    matrixEntryId: tap.matrixEntryId,
    packageId: tap.packageId,
    profileId: tap.profileId,
    surfaceId: tap.surfaceId,
    target: tap.target,
    permissionScenario: tap.permissionScenario,
    seed: tap.seed,
    adapterVersion: tap.adapterVersion,
  }).toEqual({
    allowedNetworkOrigins: expected.networkEnabled ? [RACE_SERVER_ORIGIN] : [],
    credentialAliases: expected.networkEnabled ? ["platform-session"] : [],
    matrixEntryId: expected.matrixEntryId,
    packageId: PACKAGE_ID,
    profileId: expected.profileId,
    surfaceId: SURFACE_ID,
    target: TARGET,
    permissionScenario: expected.permissionScenario,
    seed: expected.seed,
    adapterVersion: SDK_VERSION,
  });
  expect(tap.environment).toEqual({
    viewport: { width: 1280, height: 720 },
    locale: "en-US",
    timezone: "UTC",
    theme: expected.theme,
    reducedMotion: true,
    seed: expected.seed,
    fixedNow: FIXED_NOW,
  });
  expect(tap.sourceDigest).toMatch(SHA256);
  expect(tap.testBundleDigest).toMatch(SHA256);
  expect(tap.descriptorDigest).toMatch(SHA256);
  expect(tap.policyDigest).toMatch(SHA256);
  expect(tap.fixtureDigest).toMatch(SHA256);
}

type AuthorizationExpectation = Readonly<{
  actionId: string;
  autonomy: "do" | "listen" | "plan";
  allowed: boolean;
}>;

export function hasHostAuthorizationDecision(
  entries: TapMiniappTestFixtureLedger["entries"],
  expected: AuthorizationExpectation,
): boolean {
  return entries.some(
    (entry) =>
      entry.kind === "host-action" &&
      entry.operation === "authorization.check" &&
      typeof entry.detail === "object" &&
      entry.detail !== null &&
      !Array.isArray(entry.detail) &&
      Reflect.get(entry.detail, "actionId") === expected.actionId &&
      Reflect.get(entry.detail, "autonomy") === expected.autonomy &&
      Reflect.get(entry.detail, "allowed") === expected.allowed,
  );
}

export function hasAnyHostAuthorizationDecision(
  entries: TapMiniappTestFixtureLedger["entries"],
  actionId: string,
): boolean {
  return entries.some(
    (entry) =>
      entry.kind === "host-action" &&
      entry.operation === "authorization.check" &&
      typeof entry.detail === "object" &&
      entry.detail !== null &&
      !Array.isArray(entry.detail) &&
      Reflect.get(entry.detail, "actionId") === actionId,
  );
}

export function hasPlatformAuthorizationDecision(
  entries: TapMiniappTestFixtureLedger["entries"],
  expected: AuthorizationExpectation & Readonly<{ action: string }>,
): boolean {
  return entries.some(
    (entry) =>
      entry.kind === "platform" &&
      entry.operation === "authorization.check" &&
      typeof entry.detail === "object" &&
      entry.detail !== null &&
      !Array.isArray(entry.detail) &&
      Reflect.get(entry.detail, "action") === expected.action &&
      Reflect.get(entry.detail, "actionId") === expected.actionId &&
      Reflect.get(entry.detail, "autonomy") === expected.autonomy &&
      Reflect.get(entry.detail, "allowed") === expected.allowed,
  );
}
