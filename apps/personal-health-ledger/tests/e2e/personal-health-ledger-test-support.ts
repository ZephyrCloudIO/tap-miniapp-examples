import {
  expect,
  type TapMiniappTestFixture,
  type TapMiniappTestFixtureLedger,
  type TapMiniappTestFixtureSnapshot,
  type TapRstestFixtures,
} from '@theaiplatform/miniapp-sdk/testing/rstest';

export const PACKAGE_ID = 'tap_pkg_examples_personal_health_ledger_0001';
export const SURFACE_ID = 'personal-health-ledger';
export const SDK_VERSION = '0.5.3';
export const RUNNER_VERSION = '0.11.5';
export const FIXED_NOW = '2026-07-24T12:00:00Z';
export const NETWORK_ORIGINS = [
  'https://api.fda.gov',
  'https://clinicaltrials.gov',
  'https://eutils.ncbi.nlm.nih.gov',
] as const;
export const SHA256 = /^[a-f0-9]{64}$/u;
export const SEMVER =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

export type PersonalHealthLedgerProvenance = Readonly<{
  profileId: string;
  matrixEntryId: string;
  permissionScenario: string;
  seed: number;
  theme: 'light' | 'dark';
  allowedNetworkOrigins?: readonly string[];
}>;

export function expectExactProvenance(
  tap: TapMiniappTestFixture,
  expected: PersonalHealthLedgerProvenance,
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
    credentialAliases: [],
    environment: {
      viewport: {
        width: 1280,
        height: 720,
      },
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
  expect(tap.workspaceId).toMatch(/\S/u);
  expect(tap.channelId).toMatch(/\S/u);
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

function objectDetail(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
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

export function storedLedger(
  snapshot: TapMiniappTestFixtureSnapshot,
): Readonly<Record<string, unknown>> {
  const stored = snapshot.state.storage.find(
    entry =>
      entry.packageId === PACKAGE_ID &&
      entry.namespace === 'personal-health-ledger' &&
      entry.key === 'private/ledger-v1',
  );
  if (
    !stored ||
    typeof stored.value !== 'object' ||
    stored.value === null ||
    Array.isArray(stored.value)
  ) {
    throw new Error('The Personal Health Ledger fixture state is missing.');
  }
  return stored.value as Readonly<Record<string, unknown>>;
}

export async function openResearch(
  surface: TapRstestFixtures['surface'],
): Promise<void> {
  await surface.getByRole('tab', { name: 'Research', exact: true }).click();
  await expect(
    surface.getByRole('heading', {
      level: 1,
      name: 'Research & Questions',
      exact: true,
    }),
  ).toBeVisible();
}

export async function connectHealthSpecialist(
  surface: TapRstestFixtures['surface'],
): Promise<void> {
  await openResearch(surface);
  await surface
    .getByRole('button', { name: 'Connect Health Specialist', exact: true })
    .click();
}
