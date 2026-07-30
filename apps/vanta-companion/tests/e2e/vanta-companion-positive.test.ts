import { expect, test } from '@theaiplatform/miniapp-sdk/testing/rstest';
import {
  expectExactProvenance,
  FIXED_NOW_GREETING,
  hasHostAuthorizationDecision,
  hasPlatformAuthorizationDecision,
  installCompanion,
  openRemediation,
  openVantaApi,
  requireSingleCredentialAlias,
  storedState,
  VANTA_CREDENTIAL_DISPLAY_NAME,
} from './vanta-companion-test-support';

const PROVENANCE = {
  profileId: 'vanta-companion-desktop',
  matrixEntryId: 'vanta-companion-desktop-positive',
  permissionScenario: 'default',
  seed: 6929,
  theme: 'light',
  allowedNetworkOrigins: ['https://api.vanta.com'],
} as const;
const RFC_4122_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const REMEDIATION_CHANNEL_BODY = [
  '## Review branch protection',
  '',
  '**Vanta source:** https://app.vanta.com/tests/test-branch-protection',
  '**Object:** test · test-branch-protection',
  '**SOC 2:** CC6.1',
  '**Owner:** Ada Auditor',
  '**Due:** 2026-07-31',
  '',
  'Confirm the protected-branch policy and retain source evidence.',
  '',
  'Closing this channel does not close the Vanta record. Verify the source state before archival.',
].join('\n');

test('hydrates package-scoped compliance state and records storage authority', async ({
  surface,
  tap,
}) => {
  const credentialAlias = requireSingleCredentialAlias(tap);
  expectExactProvenance(tap, {
    ...PROVENANCE,
    credentialAliases: [credentialAlias],
  });
  await expect(
    surface.getByRole('heading', {
      level: 1,
      name: FIXED_NOW_GREETING,
      exact: true,
    }),
  ).toBeVisible();
  expect(storedState(await tap.fixture.snapshot())).toMatchObject({
    schemaVersion: 3,
    settings: expect.objectContaining({
      role: 'lead',
      region: 'us',
      workspaceId: tap.workspaceId,
    }),
    cases: [
      expect.objectContaining({
        id: 'vanta-case-branch-protection',
        vantaObjectId: 'test-branch-protection',
      }),
    ],
  });

  await expect
    .poll(async () =>
      hasPlatformAuthorizationDecision(
        (await tap.fixture.ledger.read()).entries,
        {
          action: 'tap.platform.storage.get',
          actionId: 'storage.read',
          autonomy: 'listen',
          allowed: true,
        },
      ),
    )
    .toBe(true);
});

test('joins the regional package specialist reproducibly and reaches the turn boundary', async ({
  surface,
  tap,
}) => {
  const installAndCapture = async () => {
    await installCompanion(surface);
    await expect(
      surface.getByText(
        'Specialist joined — authorize Vanta when the MCP prompt opens',
        { exact: true },
      ),
    ).toBeVisible();
    const snapshot = await tap.fixture.snapshot();
    const state = storedState(snapshot);
    const receipts = Reflect.get(state, 'receipts');
    if (!Array.isArray(receipts)) {
      throw new Error('The Vanta Companion receipt fixture is invalid.');
    }
    const stableReceipts = receipts.map(receipt => {
      if (
        typeof receipt !== 'object' ||
        receipt === null ||
        Array.isArray(receipt)
      ) {
        throw new Error('The Vanta Companion receipt fixture is invalid.');
      }
      const { id, ...stableReceipt } = receipt as Record<string, unknown>;
      expect(id).toMatch(RFC_4122_UUID);
      return stableReceipt;
    });
    return {
      settings: Reflect.get(state, 'settings'),
      // Fixture reset restores package data but deliberately does not rewind
      // the run-scoped entropy stream. Receipt IDs stay fresh and opaque.
      receipts: stableReceipts,
      specialistIds: snapshot.state.specialists.map(item => item.id).sort(),
      channels: snapshot.state.channels
        .filter(channel => channel.title === 'Vanta SOC 2 operations')
        .map(channel => ({
          title: channel.title,
          specialistIds: channel.specialistIds,
        })),
    };
  };

  const first = await installAndCapture();
  expect(first.specialistIds).toEqual([
    'vanta-soc2-companion-aus',
    'vanta-soc2-companion-eu',
    'vanta-soc2-companion-us',
  ]);
  expect(first.channels).toEqual([
    {
      title: 'Vanta SOC 2 operations',
      specialistIds: ['vanta-soc2-companion-us'],
    },
  ]);

  const ledger = await tap.fixture.ledger.read();
  for (const actionId of [
    'vanta-companion.coordinate',
    'channels.create',
    'channels.manage-specialists',
  ] as const) {
    expect(
      hasHostAuthorizationDecision(ledger.entries, {
        actionId,
        autonomy: 'do',
        allowed: true,
      }),
    ).toBe(true);
  }

  await tap.control.reset();
  expect(await installAndCapture()).toEqual(first);

  await surface
    .getByRole('button', { name: 'Run weekly briefing', exact: true })
    .click();
  await expect(surface.getByRole('alert')).toContainText(
    /Specialist turns are not available in the surface fixture/iu,
  );
  expect(
    hasHostAuthorizationDecision(
      (await tap.fixture.ledger.read()).entries,
      {
        actionId: 'specialists.invoke',
        autonomy: 'do',
        allowed: true,
      },
    ),
  ).toBe(true);
  expect(
    hasHostAuthorizationDecision(
      (await tap.fixture.ledger.read()).entries,
      {
        actionId: 'vanta-companion.analyze',
        autonomy: 'plan',
        allowed: true,
      },
    ),
  ).toBe(true);
});

test('creates and seeds a private remediation channel', async ({
  surface,
  tap,
}) => {
  await openRemediation(surface);
  await surface
    .getByRole('button', {
      name: 'Create channel for Review branch protection',
      exact: true,
    })
    .click();
  await expect(
    surface.getByText('Private remediation channel created and seeded', {
      exact: true,
    }),
  ).toBeVisible();

  const snapshot = await tap.fixture.snapshot();
  const channel = snapshot.state.channels.find(
    item => item.title === 'SOC 2 · Review branch protection',
  );
  expect(channel?.messages).toEqual([
    expect.objectContaining({
      clientMessageId: 'vanta-case-vanta-case-branch-protection',
      body: REMEDIATION_CHANNEL_BODY,
      content: null,
    }),
  ]);
  const cases = Reflect.get(storedState(snapshot), 'cases');
  expect(cases).toEqual([
    expect.objectContaining({ channelId: channel?.roomId }),
  ]);
  for (const actionId of ['channels.create', 'channels.send-message'] as const) {
    expect(
      hasHostAuthorizationDecision(
        (await tap.fixture.ledger.read()).entries,
        { actionId, autonomy: 'do', allowed: true },
      ),
    ).toBe(true);
  }
});

test('lists and invokes a saved workflow with Vanta provenance', async ({
  surface,
  tap,
}) => {
  await openRemediation(surface);
  await surface
    .getByRole('button', {
      name: 'Invoke workflow for Review branch protection',
      exact: true,
    })
    .click();
  await expect(
    surface.getByText('SOC 2 remediation started', { exact: true }),
  ).toBeVisible();

  expect(Reflect.get(storedState(await tap.fixture.snapshot()), 'cases')).toEqual([
    expect.objectContaining({ workflowRunId: 'vanta-fixture-run-1' }),
  ]);
  const entries = (await tap.fixture.ledger.read()).entries;
  expect(
    hasHostAuthorizationDecision(entries, {
      actionId: 'workflows.list',
      autonomy: 'listen',
      allowed: true,
    }),
  ).toBe(true);
  expect(
    hasHostAuthorizationDecision(entries, {
      actionId: 'workflows.invoke',
      autonomy: 'do',
      allowed: true,
    }),
  ).toBe(true);
});

test('uses a host credential for an exact Vanta route and persists a bounded receipt', async ({
  surface,
  tap,
}) => {
  const credentialAlias = requireSingleCredentialAlias(tap);
  await openVantaApi(surface);
  await surface
    .getByRole('button', { name: 'Load credentials', exact: true })
    .click();
  await expect(
    surface.getByText(
      'Found 1 host-managed HTTP credential',
      { exact: true },
    ),
  ).toBeVisible();
  const credential = surface.getByLabel('Host credential');
  await expect(credential).toHaveValue(credentialAlias);
  await expect(
    credential.getByRole('option', {
      name: `${VANTA_CREDENTIAL_DISPLAY_NAME} · http_bearer`,
      exact: true,
    }),
  ).toHaveAttribute('value', credentialAlias);
  expect(
    hasPlatformAuthorizationDecision(
      (await tap.fixture.ledger.read()).entries,
      {
        action: 'tap.platform.credentials.list-http',
        actionId: 'credentials.read',
        autonomy: 'listen',
        allowed: true,
      },
    ),
  ).toBe(true);

  const fixtureBeforeRequest = await tap.fixture.snapshot();
  const routes = fixtureBeforeRequest.state.httpScripts.filter(
    script =>
      script.request.method === 'GET' &&
      script.request.url === 'https://api.vanta.com/v1/audits',
  );
  expect(routes).toHaveLength(1);
  expect(routes[0]?.credentialRef).toBe(credentialAlias);
  expect(routes[0]?.credentialRef).not.toBe('vanta-api');

  await surface
    .getByRole('button', { name: 'Execute request', exact: true })
    .click();
  await expect(
    surface.getByText('Auditor API read completed', { exact: true }),
  ).toBeVisible();
  await expect(
    surface.getByText('200 OK', { exact: true }),
  ).toBeVisible();
  await expect(surface.getByText(/"id": "audit-fixture-1"/u)).toBeVisible();
  await expect(surface.getByText(/"status": "in_progress"/u)).toBeVisible();

  expect(await tap.fixture.http.requests()).toEqual({
    dropped: 0,
    requests: [
      expect.objectContaining({
        matched: true,
        credentialRef: credentialAlias,
        request: expect.objectContaining({
          method: 'GET',
          url: 'https://api.vanta.com/v1/audits',
          headers: [{ name: 'accept', value: 'application/json' }],
        }),
      }),
    ],
  });

  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.state.storage).toEqual([
    expect.objectContaining({
      namespace: 'vanta-companion',
      key: 'workspace/state-v3',
      revision: 2,
    }),
  ]);
  expect(Reflect.get(storedState(snapshot), 'receipts')).toEqual([
    expect.objectContaining({
      id: expect.stringMatching(RFC_4122_UUID),
      kind: 'vanta-api',
      sourceId: 'GET /v1/audits',
      summary: 'Auditor API GET /v1/audits completed with 200',
      actor: 'lead',
      outcome: 'completed',
    }),
  ]);
  expect(JSON.stringify(storedState(snapshot))).not.toContain(
    'audit-fixture-1',
  );

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasHostAuthorizationDecision(ledger.entries, {
      actionId: 'credentials.use',
      autonomy: 'do',
      allowed: true,
    }),
  ).toBe(true);
  expect(
    hasPlatformAuthorizationDecision(ledger.entries, {
      action: 'tap.platform.http.request',
      actionId: 'network.request',
      autonomy: 'do',
      allowed: true,
    }),
  ).toBe(true);
  expect(
    ledger.entries.filter(
      entry => entry.kind === 'native' && entry.operation === 'http.request',
    ),
  ).toHaveLength(1);
});
