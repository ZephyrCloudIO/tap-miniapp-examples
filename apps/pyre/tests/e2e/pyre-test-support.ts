import {
  expect,
  type TapMiniappTestFixture,
  type TapMiniappTestFixtureLedger,
  type TapMiniappTestFixtureSeed,
  type TapRstestFixtures,
} from "@theaiplatform/miniapp-sdk/testing/rstest";

export const PACKAGE_ID = "tap_pkg_examples_pyre_0001";
export const SURFACE_ID = "pyre";
export const TARGET = "desktop";
export const GITHUB_ORIGIN = "https://api.github.com";
export const GITHUB_EVIDENCE_URL =
  `${GITHUB_ORIGIN}/repos/ZephyrCloudIO/fixture/commits/main`;
export const GITHUB_CREDENTIAL_DISPLAY_NAME = "Test Lab GitHub bearer";
export const STORAGE_NAMESPACE = "pyre";
export const STORAGE_KEY = "investigations/v2";
export const FIXTURE_INCIDENT_ID = "inc_fixture_checkout";
export const FIXTURE_CHANNEL_ID = "pyre-fixture-channel";
export const FIXTURE_WORKFLOW_ID = "pyre-fixture-collection";
export const FIXTURE_CONVERSATION_ID = "pyre-fixture-conversation";
export const SHA256 = /^[a-f0-9]{64}$/u;
const SEMVER =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const ARTIFACTS = {
  trace: "failure-only",
  screenshots: "failure-only",
} as const;

type TapSurface = TapRstestFixtures["surface"];

export async function expectReadySurface(surface: TapSurface): Promise<void> {
  await expect(
    surface.getByRole("heading", {
      level: 1,
      name: "Checkout API elevated errors",
    }),
  ).toBeVisible();
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
    credentialAliases?: readonly string[];
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
    adapterVersion: "0.4.1",
    allowedNetworkOrigins: expected.allowedOrigins ?? [GITHUB_ORIGIN],
    artifacts: ARTIFACTS,
    credentialAliases: expected.credentialAliases ?? [],
    dataScope: "fixture",
    environment,
    hostContractVersion: "1",
    matrixEntryId: expected.matrixEntryId,
    mode: "surface",
    packageId: PACKAGE_ID,
    permissionScenario: expected.permissionScenario,
    profileId: expected.profileId,
    runnerName: "rstest",
    runnerVersion: "0.11.3",
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

export function requireSingleCredentialAlias(
  tap: TapMiniappTestFixture,
): string {
  expect(tap.credentialAliases).toHaveLength(1);
  const alias = tap.credentialAliases[0];
  if (!alias) throw new Error("The credential fixture alias is missing.");
  expect(alias).toMatch(/\S/u);
  return alias;
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

export async function openPlatform(surface: TapSurface): Promise<void> {
  await expectReadySurface(surface);
  await surface
    .getByRole("button", { name: "TAP Platform", exact: true })
    .click();
  await expect(surface.getByText("Platform Connections", { exact: true }))
    .toBeVisible();
}

export async function configureFixtureWorkflow(
  surface: TapSurface,
): Promise<void> {
  await surface
    .getByRole("button", { name: "Configure Collection", exact: true })
    .click();
  await surface.getByLabel("Saved workflow").selectOption(FIXTURE_WORKFLOW_ID);
  await surface
    .getByLabel("Claim or timeline gap")
    .fill("Determine whether the deployment preceded the elevated errors.");
  await surface.getByLabel("Authorized source").fill("checkout deployment");
  await surface.getByLabel("Time window start").fill("2026-07-24T11:25");
  await surface.getByLabel("Time window end").fill("2026-07-24T11:45");
  await surface.getByLabel("Bounded query").fill("deployment commit metadata");
  await surface
    .getByRole("checkbox", {
      name: /Approve this bounded collection scope/u,
    })
    .check();
}

export async function openHttpCollection(surface: TapSurface): Promise<void> {
  await surface
    .getByRole("button", { name: "Collect Evidence", exact: true })
    .click();
  await surface
    .getByLabel("Evidence title")
    .fill("Fixture deployment commit");
  await surface.getByLabel("GitHub API endpoint").fill(GITHUB_EVIDENCE_URL);
  await surface
    .getByLabel("Description")
    .fill("Exact commit metadata for the deterministic incident window.");
  await surface.getByLabel("Affected systems").fill("checkout-api");
  await surface
    .getByRole("checkbox", {
      name: /Approve this exact read-only request/u,
    })
    .check();
}

export async function seedUnprovisioned(
  tap: TapMiniappTestFixture,
): Promise<void> {
  const snapshot = await tap.fixture.snapshot();
  const seed = structuredClone(snapshot.state) as unknown as {
    projects: unknown[];
    channels: unknown[];
    vfsFiles: unknown[];
    vfsDirectories: unknown[];
    specialists: unknown[];
    storage: Array<{
      namespace: string;
      key: string;
      value: unknown;
    }>;
  };
  seed.projects = [];
  seed.channels = [];
  seed.vfsFiles = [];
  seed.vfsDirectories = [];
  seed.specialists = [];
  for (const record of seed.storage) {
    if (
      record.namespace !== STORAGE_NAMESPACE ||
      record.key !== STORAGE_KEY ||
      typeof record.value !== "object" ||
      record.value === null ||
      Array.isArray(record.value)
    ) {
      continue;
    }
    const investigations = Reflect.get(record.value, "investigations");
    if (!Array.isArray(investigations)) continue;
    Reflect.set(
      record.value,
      "investigations",
      investigations.map((investigation) =>
        typeof investigation === "object" &&
        investigation !== null &&
        !Array.isArray(investigation)
          ? { ...investigation, bindings: {} }
          : investigation,
      ),
    );
  }
  await tap.fixture.seed(seed as unknown as TapMiniappTestFixtureSeed);
}
