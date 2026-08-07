import {
  expect,
  type TapMiniappTestFixture,
  type TapMiniappTestFixtureLedger,
  type TapMiniappTestFixtureSnapshot,
  type TapRstestFixtures,
} from '@theaiplatform/miniapp-sdk/testing/rstest';

export const PACKAGE_ID = 'tap_pkg_examples_vanta_companion_0001';
export const SURFACE_ID = 'vanta-companion';
export const SDK_VERSION = '0.5.2';
export const RUNNER_VERSION = '0.11.5';
export const FIXED_NOW = '2026-07-24T12:00:00Z';
export const FIXED_NOW_GREETING = 'Good afternoon.';
export const VANTA_CREDENTIAL_DISPLAY_NAME = 'Test Lab Vanta bearer';
export const SHA256 = /^[a-f0-9]{64}$/u;
export const SEMVER =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

export type VantaProvenance = Readonly<{
  profileId: string;
  matrixEntryId: string;
  permissionScenario: string;
  seed: number;
  theme: 'light' | 'dark';
  allowedNetworkOrigins?: readonly string[];
  credentialAliases?: readonly string[];
}>;

export function expectExactProvenance(
  tap: TapMiniappTestFixture,
  expected: VantaProvenance,
): void {
  expect({
    adapterVersion: tap.adapterVersion,
    allowedNetworkOrigins: tap.allowedNetworkOrigins,
    artifacts: tap.artifacts,
    credentialAliases: tap.credentialAliases,
    environment: tap.environment,
    hostContractVersion: tap.hostContractVersion,
    matrixEntryId: tap.matrixEntryId,
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
    allowedNetworkOrigins: expected.allowedNetworkOrigins ?? [],
    artifacts: {
      trace: 'failure-only',
      screenshots:
        expected.permissionScenario === 'default' ? 'always' : 'failure-only',
    },
    credentialAliases: expected.credentialAliases ?? [],
    environment: {
      viewport: { width: 1280, height: 720 },
      locale: 'en-US',
      timezone: 'UTC',
      fixedNow: FIXED_NOW,
      theme: expected.theme,
      reducedMotion: true,
      seed: expected.seed,
    },
    hostContractVersion: '1',
    matrixEntryId: expected.matrixEntryId,
    packageId: PACKAGE_ID,
    permissionScenario: expected.permissionScenario,
    profileId: expected.profileId,
    runnerName: 'rstest',
    runnerVersion: RUNNER_VERSION,
    seed: expected.seed,
    surfaceId: SURFACE_ID,
    target: 'desktop',
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
  expect(tap.hostVersion).toMatch(SEMVER);
}

export function requireSingleCredentialAlias(
  tap: TapMiniappTestFixture,
): string {
  expect(tap.credentialAliases).toHaveLength(1);
  const alias = tap.credentialAliases[0];
  if (!alias) throw new Error('The credential fixture alias is missing.');
  expect(alias).toMatch(/\S/u);
  return alias;
}

export function hasHostAuthorizationDecision(
  entries: TapMiniappTestFixtureLedger['entries'],
  expected: {
    actionId: string;
    autonomy: 'do' | 'listen' | 'plan';
    allowed: boolean;
  },
): boolean {
  return entries.some(
    entry =>
      entry.kind === 'host-action' &&
      entry.operation === 'authorization.check' &&
      typeof entry.detail === 'object' &&
      entry.detail !== null &&
      !Array.isArray(entry.detail) &&
      Reflect.get(entry.detail, 'actionId') === expected.actionId &&
      Reflect.get(entry.detail, 'autonomy') === expected.autonomy &&
      Reflect.get(entry.detail, 'allowed') === expected.allowed,
  );
}

export function hasAnyHostAuthorizationDecision(
  entries: TapMiniappTestFixtureLedger['entries'],
  actionId: string,
): boolean {
  return entries.some(
    entry =>
      entry.kind === 'host-action' &&
      entry.operation === 'authorization.check' &&
      typeof entry.detail === 'object' &&
      entry.detail !== null &&
      !Array.isArray(entry.detail) &&
      Reflect.get(entry.detail, 'actionId') === actionId,
  );
}

export function hasPlatformAuthorizationDecision(
  entries: TapMiniappTestFixtureLedger['entries'],
  expected: {
    action: string;
    actionId: string;
    autonomy: 'do' | 'listen' | 'plan';
    allowed: boolean;
  },
): boolean {
  return entries.some(
    entry =>
      entry.kind === 'platform' &&
      entry.operation === 'authorization.check' &&
      typeof entry.detail === 'object' &&
      entry.detail !== null &&
      !Array.isArray(entry.detail) &&
      Reflect.get(entry.detail, 'action') === expected.action &&
      Reflect.get(entry.detail, 'actionId') === expected.actionId &&
      Reflect.get(entry.detail, 'autonomy') === expected.autonomy &&
      Reflect.get(entry.detail, 'allowed') === expected.allowed,
  );
}

function objectDetail(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

export function packageEventLocalName(
  entry: TapMiniappTestFixtureLedger['entries'][number],
): string | null {
  if (
    entry.kind !== 'event' ||
    entry.operation !== 'tap.fixture.package-event'
  ) {
    return null;
  }
  const detail = objectDetail(entry.detail);
  const payload = objectDetail(detail?.payload);
  const metadata = objectDetail(payload?.metadata);
  const localName = objectDetail(metadata?.localName);
  return typeof localName?.text === 'string' ? localName.text : null;
}

export function storedState(
  snapshot: TapMiniappTestFixtureSnapshot,
): Readonly<Record<string, unknown>> {
  const stored = snapshot.state.storage.find(
    entry =>
      entry.packageId === PACKAGE_ID &&
      entry.namespace === 'vanta-companion' &&
      entry.key === 'workspace/state-v3',
  );
  if (
    !stored ||
    typeof stored.value !== 'object' ||
    stored.value === null ||
    Array.isArray(stored.value)
  ) {
    throw new Error('The Vanta Companion fixture state is missing.');
  }
  return stored.value as Readonly<Record<string, unknown>>;
}

export async function openRemediation(
  surface: TapRstestFixtures['surface'],
): Promise<void> {
  await surface
    .getByRole('button', { name: /^Remediation(?:\s+\d+)?$/u })
    .click();
  await expect(
    surface.getByRole('heading', { level: 1, name: 'Cases', exact: true }),
  ).toBeVisible();
}

export async function installCompanion(
  surface: TapRstestFixtures['surface'],
): Promise<void> {
  await surface
    .getByRole('button', { name: 'Join & connect', exact: true })
    .click();
}

export async function openVantaApi(
  surface: TapRstestFixtures['surface'],
): Promise<void> {
  await surface
    .getByRole('button', { name: 'Vanta API', exact: true })
    .click();
  await expect(
    surface.getByRole('heading', {
      level: 1,
      name: 'Direct API bridge',
      exact: true,
    }),
  ).toBeVisible();
}
