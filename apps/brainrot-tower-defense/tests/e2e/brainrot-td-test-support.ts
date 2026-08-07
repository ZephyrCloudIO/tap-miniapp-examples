import {
  expect,
  type TapMiniappTestFixture,
  type TapMiniappTestFixtureLedger,
  type TapRstestFixtures,
} from "@theaiplatform/miniapp-sdk/testing/rstest";

export const PACKAGE_ID = "tap_pkg_examples_brainrot_td_0001";
export const SURFACE_ID = "brainrot-td";
export const FIXTURE_USER_ID = "tap-fixture-user-v1";
export const FIXTURE_USER_NAME = "Miniapp Test Fixture User";
export const FALLBACK_PLAYER_NAME = "TAP player";
export const FIXED_NOW = "2026-01-01T00:00:00Z";
export const SDK_VERSION = "0.5.3";
export const HOST_CONTRACT_VERSION = "1";
export const RUNNER_VERSION = "0.11.5";

const SHA256 = /^[a-f0-9]{64}$/u;
const SEMVER =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const UUID_V4 =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const ARTIFACTS = {
  trace: "failure-only",
  screenshots: "failure-only",
  maxBytes: 16_777_216,
} as const;

export type BrainrotRunKind =
  | "positive"
  | "post-projection-revoked";

export function expectExactProvenance(
  tap: TapMiniappTestFixture,
  kind: BrainrotRunKind,
): void {
  const positive = kind === "positive";
  const seed = positive ? 6929 : 6930;
  const profileId = positive
    ? "brainrot-td-desktop"
    : "brainrot-td-desktop-post-projection-revoked";
  const matrixEntryId = positive
    ? "brainrot-td-desktop-positive"
    : profileId;
  const permissionScenario = positive
    ? "default"
    : "all-denied";
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
    adapterVersion: SDK_VERSION,
    allowedNetworkOrigins: [],
    artifacts: {
      ...ARTIFACTS,
      screenshots: positive ? "always" : "failure-only",
    },
    credentialAliases: [],
    dataScope: "fixture",
    environment: {
      viewport: {
        width: 1280,
        height: 720,
      },
      locale: "en-US",
      timezone: "UTC",
      theme: positive ? "light" : "dark",
      reducedMotion: true,
      seed,
      fixedNow: FIXED_NOW,
    },
    hostContractVersion: HOST_CONTRACT_VERSION,
    matrixEntryId,
    mode: "surface",
    packageId: PACKAGE_ID,
    permissionScenario,
    profileId,
    runnerName: "rstest",
    runnerVersion: RUNNER_VERSION,
    seed,
    surfaceId: SURFACE_ID,
    target: "desktop",
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

export async function resetToLobby({
  surface,
  tap,
}: Pick<TapRstestFixtures, "surface" | "tap">): Promise<void> {
  await tap.control.reset();
  await expect(
    surface.getByRole("heading", {
      level: 1,
      name: "Defend the feed together.",
      exact: true,
    }),
  ).toBeVisible();
}

function objectDetail(
  detail: unknown,
): Readonly<Record<string, unknown>> | null {
  if (typeof detail !== "object" || detail === null || Array.isArray(detail)) {
    return null;
  }
  return detail as Readonly<Record<string, unknown>>;
}

export function hasAuthorizationDecision(
  entries: TapMiniappTestFixtureLedger["entries"],
  expected: {
    readonly kind: "host-action" | "platform";
    readonly actionId: string;
    readonly allowed: boolean;
    readonly action?: string;
    readonly autonomy?: "do" | "listen";
  },
): boolean {
  return entries.some((entry) => {
    const detail = objectDetail(entry.detail);
    return (
      entry.kind === expected.kind &&
      entry.operation === "authorization.check" &&
      detail?.actionId === expected.actionId &&
      detail.allowed === expected.allowed &&
      (expected.action === undefined || detail.action === expected.action) &&
      (expected.autonomy === undefined ||
        detail.autonomy === expected.autonomy)
    );
  });
}

export function packageEventLocalName(
  entry: TapMiniappTestFixtureLedger["entries"][number],
): string | null {
  if (entry.kind !== "event" || entry.operation !== "tap.fixture.package-event") {
    return null;
  }
  const detail = objectDetail(entry.detail);
  const payload = objectDetail(detail?.payload ?? null);
  const metadata = objectDetail(payload?.metadata ?? null);
  const localName = objectDetail(metadata?.localName ?? null);
  return typeof localName?.text === "string" ? localName.text : null;
}

export function sessionIdFromStorageKey(key: string): string | null {
  const marker = "/sessions/";
  const index = key.indexOf(marker);
  if (index < 0) return null;
  const sessionId = key.slice(index + marker.length);
  return UUID_V4.test(sessionId) ? sessionId : null;
}
