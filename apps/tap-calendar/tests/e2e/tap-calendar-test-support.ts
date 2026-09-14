import {
  expect,
  type TapMiniappTestFixture,
  type TapMiniappTestFixtureLedger,
  type TapMiniappTestFixtureSnapshot,
  type TapRstestFixtures,
} from "@theaiplatform/miniapp-sdk/testing/rstest";

export const PACKAGE_ID = "tap-calendar";
export const SURFACE_ID = "tap-calendar";
export const TARGET = "desktop";
export const STORAGE_NAMESPACE = "tap-calendar";
export const STORAGE_KEY = "users/tap-fixture-user-v1/calendar-state/v2";

const SHA256 = /^[a-f0-9]{64}$/u;
const SEMVER =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const FIXED_NOW = "2026-08-14T15:00:00Z";
const ARTIFACTS = {
  trace: "failure-only",
  screenshots: "failure-only",
  maxBytes: 8_388_608,
} as const;

export interface ExpectedRun {
  readonly matrixEntryId: string;
  readonly permissionScenario: string;
  readonly profileId: string;
  readonly seed: number;
  readonly theme: "dark" | "light";
  readonly surfaceId?: string;
  readonly viewport?: { readonly width: number; readonly height: number };
}

export function expectExactProvenance(
  tap: TapMiniappTestFixture,
  expected: ExpectedRun,
): void {
  const environment = {
    viewport: expected.viewport ?? { width: 1440, height: 900 },
    locale: "en-US",
    timezone: "America/New_York",
    theme: expected.theme,
    reducedMotion: true,
    seed: expected.seed,
    fixedNow: FIXED_NOW,
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
    adapterVersion: "0.16.0",
    allowedNetworkOrigins: [
      "http://127.0.0.1:8787",
      "https://calendar-api.theaiplatform.app",
    ],
    artifacts: {
      ...ARTIFACTS,
      screenshots:
        expected.permissionScenario === "default"
          ? "always"
          : "failure-only",
    },
    credentialAliases: ["platform-session"],
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
    seed: expected.seed,
    surfaceId: expected.surfaceId ?? SURFACE_ID,
    target: TARGET,
  });

  expect(tap.workspaceId).toMatch(/\S/u);
  expect(tap.channelId).toMatch(/\S/u);
  expect(tap.hostVersion).toMatch(SEMVER);
  for (const digest of [
    tap.descriptorDigest,
    tap.fixtureDigest,
    tap.policyDigest,
    tap.sourceDigest,
    tap.testBundleDigest,
  ]) {
    expect(digest).toMatch(SHA256);
  }
}

export async function expectReadySurface(
  surface: TapRstestFixtures["surface"],
): Promise<void> {
  await expect(surface.locator(".tap-calendar-app")).toBeVisible();
  await expect(surface.locator("#calendar-main")).toBeVisible();
  await expect(
    surface.getByText("TAP Calendar", { exact: true }).first(),
  ).toBeVisible();
}

export function storageRecord(
  snapshot: TapMiniappTestFixtureSnapshot,
): TapMiniappTestFixtureSnapshot["state"]["storage"][number] | undefined {
  return snapshot.state.storage.find(
    (entry) =>
      entry.packageId === PACKAGE_ID &&
      entry.namespace === STORAGE_NAMESPACE &&
      entry.key === STORAGE_KEY,
  );
}

export function hasPlatformAuthorizationDecision(
  entries: TapMiniappTestFixtureLedger["entries"],
  expected: { readonly actionId: string; readonly allowed: boolean },
): boolean {
  return entries.some((entry) => {
    if (
      entry.kind !== "platform" ||
      entry.operation !== "authorization.check" ||
      typeof entry.detail !== "object" ||
      entry.detail === null ||
      Array.isArray(entry.detail)
    ) {
      return false;
    }
    return (
      Reflect.get(entry.detail, "actionId") === expected.actionId &&
      Reflect.get(entry.detail, "allowed") === expected.allowed
    );
  });
}

export function hasHostAuthorizationDecision(
  entries: TapMiniappTestFixtureLedger["entries"],
  expected: { readonly actionId: string; readonly allowed: boolean },
): boolean {
  return entries.some((entry) => {
    if (
      entry.kind !== "host-action" ||
      entry.operation !== "authorization.check" ||
      typeof entry.detail !== "object" ||
      entry.detail === null ||
      Array.isArray(entry.detail)
    ) {
      return false;
    }
    return (
      Reflect.get(entry.detail, "actionId") === expected.actionId &&
      Reflect.get(entry.detail, "allowed") === expected.allowed
    );
  });
}
