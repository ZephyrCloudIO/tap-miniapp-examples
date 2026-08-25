import {
  expect,
  type TapMiniappTestFixture,
} from "@theaiplatform/miniapp-sdk/testing/rstest";

const PACKAGE_ID = "model-arena";
const SURFACE_ID = "model-arena";
const TARGET = "desktop";
const FIXED_NOW = "2026-08-17T12:00:00Z";
const SHA256 = /^[a-f0-9]{64}$/u;
const SEMVER =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

export type ModelArenaRunKind =
  | "positive"
  | "storage-denied"
  | "manage-denied"
  | "inference-denied"
  | "specialist-denied"
  | "vfs-denied";

const RUNS = {
  positive: {
    matrixEntryId: "model-arena-desktop-positive",
    permissionScenario: "default",
    profileId: "model-arena-desktop",
    screenshots: "always",
    seed: 6932,
    theme: "light",
  },
  "storage-denied": {
    matrixEntryId: "model-arena-desktop-storage-denied",
    permissionScenario: "all-denied",
    profileId: "model-arena-desktop-post-projection-revoked",
    screenshots: "failure-only",
    seed: 6933,
    theme: "dark",
  },
  "manage-denied": {
    matrixEntryId: "model-arena-desktop-manage-denied",
    permissionScenario: "deny:model-arena.manage",
    profileId: "model-arena-desktop-manage-denied",
    screenshots: "failure-only",
    seed: 6934,
    theme: "dark",
  },
  "inference-denied": {
    matrixEntryId: "model-arena-desktop-inference-denied",
    permissionScenario: "deny:inference.invoke",
    profileId: "model-arena-desktop-inference-denied",
    screenshots: "failure-only",
    seed: 6935,
    theme: "dark",
  },
  "specialist-denied": {
    matrixEntryId: "model-arena-desktop-specialist-denied",
    permissionScenario: "deny:specialists.invoke",
    profileId: "model-arena-desktop-specialist-denied",
    screenshots: "failure-only",
    seed: 6936,
    theme: "dark",
  },
  "vfs-denied": {
    matrixEntryId: "model-arena-desktop-vfs-denied",
    permissionScenario: "deny:vfs.write",
    profileId: "model-arena-desktop-vfs-denied",
    screenshots: "failure-only",
    seed: 6937,
    theme: "dark",
  },
} as const;

export function expectExactProvenance(
  tap: TapMiniappTestFixture,
  kind: ModelArenaRunKind,
): void {
  const expected = RUNS[kind];
  expect({
    adapterVersion: tap.adapterVersion,
    artifacts: tap.artifacts,
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
    adapterVersion: "0.12.0",
    artifacts: {
      screenshots: expected.screenshots,
      trace: "failure-only",
    },
    dataScope: "fixture",
    environment: {
      viewport: { width: 1280, height: 720 },
      locale: "en-US",
      timezone: "UTC",
      theme: expected.theme,
      reducedMotion: true,
      seed: expected.seed,
      fixedNow: FIXED_NOW,
    },
    hostContractVersion: "1",
    matrixEntryId: expected.matrixEntryId,
    mode: "surface",
    packageId: PACKAGE_ID,
    permissionScenario: expected.permissionScenario,
    profileId: expected.profileId,
    runnerName: "rstest",
    runnerVersion: "0.11.5",
    seed: expected.seed,
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
