import {
  expect,
  type TapMiniappTestFixture,
  type TapMiniappTestFixtureLedger,
  type TapMiniappTestFixtureSnapshot,
  type TapRstestFixtures,
} from "@theaiplatform/miniapp-sdk/testing/rstest";

export const PACKAGE_ID =
  "tap_pkg_examples_unofficial_suno_player_0001";
export const SURFACE_ID = "unofficial-suno-player";
export const TARGET = "desktop";
export const STORAGE_NAMESPACE = "unofficial-suno-player";
export const WORKFLOW_ID = "fixture-manual-brief-workflow";
export const SEEDED_SPECIALIST_ID = "fixture-suno-specialist";

const FIXED_NOW = "2026-07-24T12:00:00Z";
const SHA256 = /^[a-f0-9]{64}$/u;
const SEMVER =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
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
}

export function expectExactProvenance(
  tap: TapMiniappTestFixture,
  expected: ExpectedRun,
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
    adapterVersion: "0.4.6",
    allowedNetworkOrigins: [],
    artifacts: {
      ...ARTIFACTS,
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
    seed: expected.seed,
    surfaceId: SURFACE_ID,
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
  await expect(surface.getByText("NO TRACK LOADED", { exact: true }))
    .toBeVisible();
  await expect(surface.getByText("QUEUE EMPTY", { exact: true })).toBeVisible();
}

export async function openContext(
  surface: TapRstestFixtures["surface"],
): Promise<void> {
  await expectReadySurface(surface);
  await surface.getByRole("tab", { name: /^Context/u }).click();
  await expect(
    surface.getByText("Channel consent", { exact: true }),
  ).toBeVisible();
}

export async function openSettings(
  surface: TapRstestFixtures["surface"],
): Promise<void> {
  await expectReadySurface(surface);
  await surface
    .getByRole("tab", { name: "Settings", exact: true })
    .click();
  await expect(
    surface.getByText("Listening privacy", { exact: true }),
  ).toBeVisible();
}

function objectDetail(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Readonly<Record<string, unknown>>;
}

export function hasAuthorizationDecision(
  entries: TapMiniappTestFixtureLedger["entries"],
  expected: {
    readonly actionId: string;
    readonly allowed: boolean;
    readonly kind: "host-action" | "platform";
  },
): boolean {
  return entries.some((entry) => {
    const detail = objectDetail(entry.detail);
    return (
      entry.kind === expected.kind &&
      entry.operation === "authorization.check" &&
      detail?.actionId === expected.actionId &&
      detail.allowed === expected.allowed
    );
  });
}

export function hasOperation(
  entries: TapMiniappTestFixtureLedger["entries"],
  kind: "event" | "host-action" | "native" | "platform",
  operation: string,
): boolean {
  return entries.some(
    (entry) => entry.kind === kind && entry.operation === operation,
  );
}

export function packageEventLocalName(
  entry: TapMiniappTestFixtureLedger["entries"][number],
): string | null {
  if (
    entry.kind !== "event" ||
    entry.operation !== "tap.fixture.package-event"
  ) {
    return null;
  }
  const detail = objectDetail(entry.detail);
  const payload = objectDetail(detail?.payload);
  const metadata = objectDetail(payload?.metadata);
  const localName = objectDetail(metadata?.localName);
  return typeof localName?.text === "string" ? localName.text : null;
}

export function channelStorageKey(channelId: string): string {
  return `channel/${channelId}/state`;
}

export function channelListeningRoom(channelId: string): string {
  return `channel/${channelId}/listening`;
}

export function channelStorageRecord(
  snapshot: TapMiniappTestFixtureSnapshot,
  channelId: string,
): TapMiniappTestFixtureSnapshot["state"]["storage"][number] | undefined {
  return snapshot.state.storage.find(
    (entry) =>
      entry.namespace === STORAGE_NAMESPACE &&
      entry.key === channelStorageKey(channelId),
  );
}

export function preferenceStorageRecords(
  snapshot: TapMiniappTestFixtureSnapshot,
): TapMiniappTestFixtureSnapshot["state"]["storage"] {
  return snapshot.state.storage.filter(
    (entry) =>
      entry.namespace === STORAGE_NAMESPACE &&
      entry.key.startsWith("user/"),
  );
}
