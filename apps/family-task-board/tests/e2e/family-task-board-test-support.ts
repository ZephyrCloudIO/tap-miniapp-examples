import {
  expect,
  type TapMiniappTestFixture,
  type TapMiniappTestFixtureLedger,
} from "@theaiplatform/miniapp-sdk/testing/rstest";

export const PACKAGE_ID = "tap_pkg_examples_family_task_board_0001";
export const SURFACE_ID = "family-task-board";
export const TARGET = "desktop";
export const STORAGE_NAMESPACE = "family-task-board";
export const STORAGE_KEY = "household/main";
export const SHA256 = /^[a-f0-9]{64}$/u;
const SEMVER =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const TEST_ARTIFACTS = {
  trace: "failure-only",
  screenshots: "failure-only",
} as const;

export function expectExactProvenance(
  tap: TapMiniappTestFixture,
  expected: {
    readonly matrixEntryId: string;
    readonly permissionScenario: string;
    readonly profileId: string;
    readonly seed: number;
    readonly theme: "light" | "dark";
  },
): void {
  const environment = {
    viewport: {
      width: 1280,
      height: 720,
    },
    locale: "en-US",
    timezone: "UTC",
    theme: expected.theme,
    reducedMotion: true,
    seed: expected.seed,
    fixedNow: "2026-07-24T12:00:00Z",
  } as const;

  expect({
    adapterVersion: tap.adapterVersion,
    allowedNetworkOrigins: tap.allowedNetworkOrigins,
    artifacts: tap.artifacts,
    credentialAliases: tap.credentialAliases,
    dataScope: tap.dataScope,
    environment: tap.environment,
    hostContractVersion: tap.hostContractVersion,
    matrixEntryId: tap.matrixEntryId,
    mode: tap.mode,
    packageId: tap.packageId,
    permissionScenario: tap.permissionScenario,
    profileId: tap.profileId,
    runnerName: tap.runnerName,
    runnerVersion: tap.runnerVersion,
    seed: tap.seed,
    surfaceId: tap.surfaceId,
    target: tap.target,
  }).toEqual({
    adapterVersion: "0.7.0",
    allowedNetworkOrigins: [],
    artifacts: {
      ...TEST_ARTIFACTS,
      screenshots:
        expected.permissionScenario === "default"
          ? "always"
          : "failure-only",
    },
    credentialAliases: [],
    dataScope: "fixture",
    environment,
    hostContractVersion: "1",
    matrixEntryId: expected.matrixEntryId,
    mode: "surface",
    packageId: PACKAGE_ID,
    permissionScenario: expected.permissionScenario,
    profileId: expected.profileId,
    runnerName: "rstest",
    runnerVersion: "0.11.5",
    seed: environment.seed,
    surfaceId: SURFACE_ID,
    target: TARGET,
  });

  for (const digest of [
    tap.descriptorDigest,
    tap.fixtureDigest,
    tap.policyDigest,
    tap.sourceDigest,
    tap.testBundleDigest,
  ]) {
    expect(digest).toMatch(SHA256);
  }
  expect(tap.workspaceId).toMatch(/\S/u);
  expect(tap.channelId).toMatch(/\S/u);
  expect(tap.hostVersion).toMatch(SEMVER);
}

export function hasHostAuthorizationDecision(
  entries: TapMiniappTestFixtureLedger["entries"],
  expected: {
    readonly actionId: string;
    readonly autonomy: "do" | "listen";
    readonly allowed: boolean;
  },
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
