import {
  expect,
  type TapMiniappTestFixture,
  type TapMiniappTestFixtureLedger,
  type TapRstestFixtures,
} from "@theaiplatform/miniapp-sdk/testing/rstest";

export const PACKAGE_ID = "tap_pkg_examples_engineering_change_0001";
export const SURFACE_ID = "engineering-change";
export const TARGET = "desktop";
export const GITHUB_ORIGIN = "https://api.github.com";
export const GITHUB_DIFF_URL =
  `${GITHUB_ORIGIN}/repos/ZephyrCloudIO/ze-agency-tauri/pulls/7989/files`;
export const STORAGE_NAMESPACE = "engineering-change";
export const STORAGE_KEY = "changes/v1";
export const FIXTURE_CHANGE_ID = "EC-2026-0001";
export const FIXTURE_CHANNEL_ID = "engineering-change-fixture-channel";
export const FIXTURE_WORKFLOW_ID = "engineering-change-fixture-transition";
export const SHA256 = /^[a-f0-9]{64}$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const ARTIFACTS = {
  trace: "failure-only",
  screenshots: "failure-only",
} as const;

type TapSurface = TapRstestFixtures["surface"];

export async function expectReadySurface(surface: TapSurface): Promise<void> {
  await expect(
    surface.getByRole("heading", { name: "Change ledger at a glance" }),
  ).toBeVisible();
}

export async function expectMatchingAlert(
  surface: TapSurface,
  expected: string | RegExp,
): Promise<void> {
  const alert = surface.getByRole("alert").filter({ hasText: expected });
  await expect(alert).toHaveCount(1);
  await expect(alert).toContainText(expected);
}

export function expectExactProvenance(
  tap: TapMiniappTestFixture,
  expected: {
    matrixEntryId: string;
    permissionScenario: string;
    profileId: string;
    seed: number;
    theme: "light" | "dark";
    allowedOrigins?: readonly string[];
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
    adapterVersion: "0.4.6",
    allowedNetworkOrigins: expected.allowedOrigins ?? [GITHUB_ORIGIN],
    artifacts: {
      ...ARTIFACTS,
      screenshots: expected.permissionScenario === "default" ? "always" : "failure-only",
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

export function hasAuthorizationDecision(
  entries: TapMiniappTestFixtureLedger["entries"],
  expected: {
    actionId: string;
    allowed: boolean;
    autonomy?: "listen" | "plan" | "do";
    kind: "host-action" | "platform";
  },
): boolean {
  return entries.some(
    (entry) =>
      entry.kind === expected.kind &&
      entry.operation === "authorization.check" &&
      typeof entry.detail === "object" &&
      entry.detail !== null &&
      !Array.isArray(entry.detail) &&
      Reflect.get(entry.detail, "actionId") === expected.actionId &&
      Reflect.get(entry.detail, "allowed") === expected.allowed &&
      (expected.autonomy === undefined ||
        Reflect.get(entry.detail, "autonomy") === expected.autonomy),
  );
}

export function hasAnyAuthorizationDecision(
  entries: TapMiniappTestFixtureLedger["entries"],
  actionId: string,
): boolean {
  return entries.some(
    (entry) =>
      (entry.kind === "host-action" || entry.kind === "platform") &&
      entry.operation === "authorization.check" &&
      typeof entry.detail === "object" &&
      entry.detail !== null &&
      !Array.isArray(entry.detail) &&
      Reflect.get(entry.detail, "actionId") === actionId,
  );
}

export async function openChangeDetail(surface: TapSurface): Promise<void> {
  await expectReadySurface(surface);
  await surface
    .getByTestId(`engineering-change-overview-open-${FIXTURE_CHANGE_ID}`)
    .click();
  await expect(surface.getByTestId("engineering-change-detail-phase")).toBeVisible();
}

export async function readStoredChanges(
  tap: TapMiniappTestFixture,
): Promise<{ changes: unknown[]; revision: number | undefined }> {
  const snapshot = await tap.fixture.snapshot();
  const record = snapshot.state.storage.find(
    (entry) => entry.namespace === STORAGE_NAMESPACE && entry.key === STORAGE_KEY,
  );
  const changes =
    typeof record?.value === "object" && record.value !== null && !Array.isArray(record.value)
      ? Reflect.get(record.value, "changes")
      : undefined;
  return {
    changes: Array.isArray(changes) ? changes : [],
    revision: record?.revision,
  };
}
