import {
  expect,
  test,
} from '@theaiplatform/miniapp-sdk/testing/rstest';
import {
  NETWORK_ORIGINS,
  PACKAGE_ID,
  connectHealthSpecialist,
  expectExactProvenance,
  hasHostAuthorizationDecision,
  hasPlatformAuthorizationDecision,
  openResearch,
  packageEventLocalName,
  storedLedger,
} from './personal-health-ledger-test-support';

const POSITIVE_PROVENANCE = {
  profileId: 'personal-health-ledger-desktop',
  matrixEntryId: 'personal-health-ledger-desktop-positive',
  permissionScenario: 'default',
  seed: 6929,
  theme: 'light',
  allowedNetworkOrigins: NETWORK_ORIGINS,
} as const;

test('hydrates the exact package-scoped ledger and publishes its mount event', async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, POSITIVE_PROVENANCE);
  await expect(
    surface.getByRole('heading', { level: 1, name: 'Today', exact: true }),
  ).toBeVisible();
  await expect(surface.getByText('Test Lab Ledger', { exact: true })).toBeVisible();

  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.workspaceId).toBe(tap.workspaceId);
  expect(storedLedger(snapshot)).toMatchObject({
    schemaVersion: 4,
    ownerLabel: 'Test Lab Ledger',
    role: 'owner',
    items: [
      expect.objectContaining({
        id: 'fixture-item-magnesium',
        name: 'Magnesium Glycinate',
      }),
    ],
  });

  await expect
    .poll(
      async () => {
        const entries = (await tap.fixture.ledger.read()).entries;
        return {
          mounted: entries.some(
            entry => packageEventLocalName(entry) === 'surface.mounted',
          ),
          storageRead: hasPlatformAuthorizationDecision(entries, {
            action: 'tap.platform.storage.get',
            actionId: 'storage.read',
            autonomy: 'listen',
            allowed: true,
          }),
        };
      },
      { timeout: 5_000 },
    )
    .toEqual({ mounted: true, storageRead: true });

  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
  for (const [actionId, autonomy] of [
    ['health-ledger.manage', 'plan'],
    ['health-ledger.research', 'plan'],
    ['health-ledger.export', 'do'],
  ] as const) {
    expect(
      hasHostAuthorizationDecision(ledger.entries, {
        actionId,
        autonomy,
        allowed: true,
      }),
    ).toBe(true);
  }
  expect(
    ledger.entries.some(
      entry =>
        entry.kind === 'platform' &&
        entry.operation === 'storage.get' &&
        typeof entry.detail === 'object' &&
        entry.detail !== null &&
        Reflect.get(entry.detail, 'namespace') === 'personal-health-ledger',
    ),
  ).toBe(true);
});

test('refreshes all exact official-source routes and persists their receipts', async ({
  surface,
  tap,
}) => {
  await openResearch(surface);
  await surface
    .getByRole('checkbox', { name: /Approve this public-source query/u })
    .click();
  await surface
    .getByRole('button', { name: 'Refresh Official Sources', exact: true })
    .click();

  await expect(
    surface.getByText('Official research sources refreshed', { exact: true }),
  ).toBeVisible();
  await expect(
    surface.getByText('Fixture magnesium evidence', { exact: true }),
  ).toBeVisible();
  await expect(
    surface.getByText('Fixture magnesium trial', { exact: true }),
  ).toBeVisible();
  await expect(
    surface.getByText('FDA label: Fixture Magnesium / magnesium glycinate', {
      exact: true,
    }),
  ).toBeVisible();

  const captures = await tap.fixture.http.requests();
  expect(captures.dropped).toBe(0);
  expect(captures.requests).toHaveLength(4);
  expect(captures.requests.every(request => request.matched)).toBe(true);
  expect(captures.requests.map(capture => capture.request.url)).toEqual([
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi',
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi',
    'https://clinicaltrials.gov/api/v2/studies',
    'https://api.fda.gov/drug/label.json',
  ]);

  const snapshot = await tap.fixture.snapshot();
  const value = storedLedger(snapshot);
  expect(Reflect.get(value, 'researchRecords')).toEqual([
    expect.objectContaining({
      source: 'pubmed',
      sourceRecordId: '12345678',
    }),
    expect.objectContaining({
      source: 'clinical-trials',
      sourceRecordId: 'NCT00000001',
    }),
    expect.objectContaining({
      source: 'openfda',
      sourceRecordId: 'fixture-label-1',
    }),
  ]);
  expect(Reflect.get(value, 'researchWatches')).toEqual([
    expect.objectContaining({
      itemId: 'fixture-item-magnesium',
      query: 'magnesium glycinate',
      sources: [
        expect.objectContaining({ source: 'pubmed', success: true }),
        expect.objectContaining({ source: 'clinical-trials', success: true }),
        expect.objectContaining({ source: 'openfda', success: true }),
      ],
    }),
  ]);

  expect(
    (await tap.fixture.ledger.read()).entries.filter(
      entry => entry.kind === 'native' && entry.operation === 'http.request',
    ),
  ).toHaveLength(4);
  await expect
    .poll(
      async () =>
        (await tap.fixture.ledger.read()).entries.some(
          entry => packageEventLocalName(entry) === 'ledger.changed',
        ),
      { timeout: 5_000 },
    )
    .toBe(true);
});

test('installs, channels, and persists the specialist reproducibly after reset', async ({
  surface,
  tap,
}) => {
  const connectAndRead = async () => {
    await connectHealthSpecialist(surface);
    await expect(surface.getByText('Connected', { exact: true })).toBeVisible();
    await expect(
      surface.getByText('Personal Health Researcher connected', { exact: true }),
    ).toBeVisible();
    const snapshot = await tap.fixture.snapshot();
    const value = storedLedger(snapshot);
    expect(Reflect.get(value, 'audit')).toEqual([
      {
        id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
        ),
        occurredAt: '2026-07-24T12:00:00.000Z',
        action: 'connected',
        entityType: 'specialist',
        entityId: 'personal-health-researcher',
      },
    ]);
    return {
      specialistBinding: Reflect.get(value, 'specialistBinding'),
    };
  };

  const first = await connectAndRead();
  expect(first.specialistBinding).toEqual({
    channelId: 'tap-fixture-channel-1',
    specialistId: 'personal-health-researcher',
    connectedAt: '2026-07-24T12:00:00.000Z',
  });
  const firstSnapshot = await tap.fixture.snapshot();
  expect(
    firstSnapshot.state.channels.find(
      channel => channel.roomId === 'tap-fixture-channel-1',
    ),
  ).toMatchObject({
    title: 'Personal Health Ledger research',
    specialistIds: ['personal-health-researcher'],
  });
  expect(
    firstSnapshot.state.specialists.some(
      specialist => specialist.id === 'personal-health-researcher',
    ),
  ).toBe(true);

  const firstLedger = await tap.fixture.ledger.read();
  for (const actionId of [
    'specialists.manage',
    'channels.create',
    'channels.manage-specialists',
  ] as const) {
    expect(
      hasHostAuthorizationDecision(firstLedger.entries, {
        actionId,
        autonomy: 'do',
        allowed: true,
      }),
    ).toBe(true);
  }
  expect(
    firstLedger.entries.some(
      entry =>
        entry.kind === 'host-action' &&
        entry.operation === 'platform.specialist.join',
    ),
  ).toBe(true);

  await tap.control.reset();
  const second = await connectAndRead();
  expect(second).toEqual(first);

  await surface
    .getByRole('checkbox', { name: /Approve this private-context transfer/u })
    .click();
  await surface
    .getByRole('button', { name: 'Run Find Current Evidence', exact: true })
    .click();
  await expect(surface.getByRole('alert')).toContainText(
    /Specialist turns are not available in the surface fixture/iu,
  );
  const invocationLedger = await tap.fixture.ledger.read();
  expect(
    hasHostAuthorizationDecision(invocationLedger.entries, {
      actionId: 'specialists.invoke',
      autonomy: 'do',
      allowed: true,
    }),
  ).toBe(true);
  expect(
    Reflect.get(storedLedger(await tap.fixture.snapshot()), 'specialistRuns'),
  ).toEqual([]);
});

test('writes the clinician summary only to the active conversation VFS', async ({
  surface,
  tap,
}) => {
  await surface.getByRole('tab', { name: 'Share', exact: true }).click();
  await expect(
    surface.getByRole('heading', {
      level: 1,
      name: 'Share & Export',
      exact: true,
    }),
  ).toBeVisible();
  await surface
    .getByRole('button', { name: /Save to TAP VFS/u })
    .click();
  await expect(
    surface.getByRole('status').filter({
      hasText: 'Summary saved to the active conversation’s protected VFS.',
    }),
  ).toBeVisible();

  const snapshot = await tap.fixture.snapshot();
  const exported = snapshot.state.vfsFiles.find(
    file =>
      file.conversationId === tap.channelId &&
      file.path ===
        'personal-health-ledger/clinician-summary-2026-07-24.txt',
  );
  expect(exported).toBeDefined();
  expect(
    new TextDecoder().decode(Uint8Array.from(exported?.data ?? [])),
  ).toContain('Personal Health Ledger — Test Lab Ledger');

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasHostAuthorizationDecision(ledger.entries, {
      actionId: 'vfs.write',
      autonomy: 'do',
      allowed: true,
    }),
  ).toBe(true);
  expect(
    ledger.entries.some(
      entry =>
        entry.kind === 'host-action' &&
        entry.operation === 'platform.vfs.write-file',
    ),
  ).toBe(true);
  expect(
    snapshot.state.vfsFiles.every(file => file.conversationId === tap.channelId),
  ).toBe(true);
  expect(
    snapshot.state.storage.every(entry => entry.packageId === PACKAGE_ID),
  ).toBe(true);
});
