import { expect, test } from '@theaiplatform/miniapp-sdk/testing/rstest';
import {
  expectExactProvenance,
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
    surface.getByText('Review branch protection', { exact: true }),
  ).toBeVisible();
  expect(storedState(await tap.fixture.snapshot())).toMatchObject({
    schemaVersion: 3,
    settings: expect.objectContaining({
      role: 'lead',
      region: 'us',
      workspaceId: 'tap-fixture-workspace-v1',
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

test('installs the exact Vanta MCP specialist reproducibly and reaches the turn boundary', async ({
  surface,
  tap,
}) => {
  const installAndCapture = async () => {
    await installCompanion(surface);
    await expect(
      surface.getByText(
        'Specialist installed — authorize Vanta when the MCP prompt opens',
        { exact: true },
      ),
    ).toBeVisible();
    const snapshot = await tap.fixture.snapshot();
    const specialist = snapshot.state.specialists.find(
      item => item.id === 'vanta-soc2-companion',
    );
    const state = storedState(snapshot);
    return {
      settings: Reflect.get(state, 'settings'),
      receipts: Reflect.get(state, 'receipts'),
      specialist: specialist?.value,
      channels: snapshot.state.channels.map(channel => ({
        title: channel.title,
        specialistIds: channel.specialistIds,
      })),
    };
  };

  const first = await installAndCapture();
  expect(first.specialist).toMatchObject({
    id: 'vanta-soc2-companion',
    version: '0.4.1',
    tooling: {
      mcpTemplates: [
        expect.objectContaining({
          id: 'vanta-official-mcp',
          required: true,
          transport: {
            type: 'streamableHttp',
            url: 'https://mcp.vanta.com/mcp',
          },
          toolPolicy: expect.objectContaining({
            default: 'allowlistOnly',
            blockedTools: [],
          }),
        }),
      ],
    },
  });
  expect(first.channels).toEqual([
    {
      title: 'Vanta SOC 2 operations',
      specialistIds: ['vanta-soc2-companion'],
    },
  ]);

  const ledger = await tap.fixture.ledger.read();
  for (const actionId of [
    'vanta-companion.coordinate',
    'specialists.manage',
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
  expect(channel?.messages).toHaveLength(1);
  expect(channel?.messages[0]).toMatchObject({
    name: 'Vanta remediation case',
    content: 'Review branch protection',
  });
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

test('discovers the metadata-only credential fixture without issuing HTTP', async ({
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
  expect(await tap.fixture.http.requests()).toEqual({
    dropped: 0,
    requests: [],
  });
});
