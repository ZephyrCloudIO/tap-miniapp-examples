import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import Ajv2020 from 'ajv/dist/2020.js';

const require = createRequire(import.meta.url);
const schema = JSON.parse(
  fs.readFileSync(
    require.resolve('@theaiplatform/miniapp-sdk/config-schema.json'),
    'utf8',
  ),
);
const manifest = JSON.parse(
  fs.readFileSync(new URL('../manifest.tap.json', import.meta.url), 'utf8'),
);
const packageJson = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const validate = new Ajv2020({
  allErrors: true,
  strict: false,
  formats: { uint8: true, uint16: true, uint32: true, uint64: true, uri: true },
}).compile(schema);

if (!validate(manifest)) {
  console.error(validate.errors);
  process.exit(1);
}
const specialistAssetUrl = new URL(
  '../specialists/tap-email-specialist/0.2.0.json',
  import.meta.url,
);
const specialistAsset = JSON.parse(fs.readFileSync(specialistAssetUrl, 'utf8'));
const emailOperationsSkillUrl = new URL(
  '../skills/email-operations/0.2.0/SKILL.md',
  import.meta.url,
);
const stagedLiveMcpInputSchemaNames = [
  'list-email-accounts.input.json',
  'search-email-threads.input.json',
  'get-email-thread.input.json',
  'read-email-messages.input.json',
  'get-email-command-receipt.input.json',
];
// SDK authoring consumes a build manifest. The lifecycle emits the
// generation-2 exact-byte source descriptor into .tap-package; package and
// release identity are minted only after import and must not be authored here.
assert.equal(manifest.buildSchemaVersion, 2);
assert.equal(manifest.versionLabel, packageJson.version);
assert.equal(manifest.presentation.slug, 'tap-email');
assert.equal('descriptorVersion' in manifest, false);
assert.equal('package' in manifest, false);
assert.equal('release' in manifest, false);
assert.equal('lifecycle' in manifest, false);
assert.equal(manifest.compatibility.tapSdk, '0.19.0');
assert.ok(manifest.targets?.desktop, 'The desktop package target is required.');
assert.ok(manifest.targets?.quickjs, 'The QuickJS package target is required.');
assert.deepEqual(manifest.runtimePolicy, {
  checkpoint: 'retained',
  lifecycleExpose: './tap/lifecycle',
  profileStorageQuotaBytes: 1_073_741_824,
});

const contribution = (kind, id) =>
  manifest.contributions.find(
    candidate => candidate.kind === kind && candidate.id === id,
  );
const specialist = contribution('specialist', 'tap-email-specialist');
const mcpServer = contribution('mcp.server', 'tap-email-mcp');
assert.ok(specialist, 'TAP Email specialist contribution is required.');
assert.ok(mcpServer, 'TAP Email MCP contribution is required.');
assert.equal(
  specialist.options.manifest,
  'specialists/tap-email-specialist/0.2.0.json',
);
assert.deepEqual(mcpServer.options.consumerPolicy.contributionIds, [
  'tap-email-specialist',
]);
for (const id of ['tap-email-mailbox-summary', 'tap-email-active-context']) {
  assert.deepEqual(contribution('mcp.tool', id).options.storageReads, [
    { namespace: 'tap-email', keyTemplate: 'operational/v1' },
  ]);
}
assert.deepEqual(
  contribution('mcp.tool', 'tap-email-activity-summary').options.storageReads,
  [{ namespace: 'tap-email', keyTemplate: 'activity/v1' }],
);

const emailOperationsSkill = contribution('agent.skill', 'email-operations');
assert.ok(emailOperationsSkill, 'Email operations skill contribution is required.');
assert.deepEqual(emailOperationsSkill.authorization.allOf, ['tap-email.view']);
assert.deepEqual(emailOperationsSkill.options.files, ['SKILL.md']);
assert.ok(fs.existsSync(emailOperationsSkillUrl), 'Email operations SKILL.md is required.');
const skillSource = fs.readFileSync(emailOperationsSkillUrl, 'utf8');
for (const toolName of [
  'get_mailbox_summary',
  'get_active_email_context',
  'get_email_activity_summary',
]) {
  assert.match(skillSource, new RegExp(`^\\s*- ${toolName}$`, 'mu'));
}
for (const unavailableToolName of [
  'list_email_accounts',
  'search_email_threads',
  'get_email_thread',
  'read_email_messages',
  'get_email_command_receipt',
]) {
  assert.doesNotMatch(
    skillSource,
    new RegExp(`^\\s*- ${unavailableToolName}$`, 'mu'),
  );
}

for (const schemaName of stagedLiveMcpInputSchemaNames) {
  const schemaUrl = new URL(`../schemas/mcp/${schemaName}`, import.meta.url);
  assert.ok(
    fs.existsSync(schemaUrl),
    `Staged live MCP input schema ${schemaName} is required.`,
  );

  const inputSchema = JSON.parse(fs.readFileSync(schemaUrl, 'utf8'));
  assert.equal(
    inputSchema.$schema,
    'https://json-schema.org/draft/2020-12/schema',
    `${schemaName} must declare JSON Schema 2020-12.`,
  );
  assert.equal(inputSchema.type, 'object', `${schemaName} must accept an object.`);
  assert.equal(
    inputSchema.additionalProperties,
    false,
    `${schemaName} must reject undeclared input properties.`,
  );
}

assert.deepEqual(specialistAsset.skills, {
  preferred: [
    {
      name: 'email-operations',
      source: 'package',
      package: { kind: 'own', contributionId: 'email-operations' },
    },
  ],
  access: 'open',
});
assert.deepEqual(specialist.authorization.allOf, [
  'tap-email.specialist',
  'tap-email.view',
]);

const miniapp = contribution('miniapp', 'tap-email-app');
for (const id of [
  'tap-email-activity-summary',
  'tap-email-email-this',
  'email-operations',
]) {
  assert.ok(
    miniapp.options.contributionIds.includes(id),
    `Miniapp composition must include ${id}.`,
  );
}

const emailThisAction = contribution('action.command', 'tap-email-email-this');
assert.ok(emailThisAction, 'Email this action contribution is required.');
assert.deepEqual(emailThisAction.authorization, { allOf: ['artifacts.read'] });
assert.deepEqual(emailThisAction.options.contexts, [
  'channel-message',
  'pull-request',
  'task',
  'repository-issue',
]);
assert.deepEqual(emailThisAction.options.launch, {
  kind: 'ui.surface',
  contributionId: 'tap-email',
});
for (const unavailableContributionId of [
  'tap-email-live-mcp',
  'tap-email-list-accounts',
  'tap-email-search-threads',
  'tap-email-get-thread',
  'tap-email-read-messages',
  'tap-email-get-command-receipt',
]) {
  assert.equal(
    contribution(
      unavailableContributionId === 'tap-email-live-mcp' ? 'mcp.server' : 'mcp.tool',
      unavailableContributionId,
    ),
    undefined,
    `${unavailableContributionId} must remain unregistered until supported scoped auth is available.`,
  );
}

const permissionCatalog = contribution(
  'permission.catalog',
  'tap-email-permissions',
);
assert.ok(permissionCatalog, 'TAP Email permission catalog is required.');
const declaredActionIds = new Set(
  permissionCatalog.options.actions.map(action => action.id),
);
for (const declaredContribution of manifest.contributions) {
  const requestedActions = [
    ...(declaredContribution.authorization?.allOf ?? []),
    ...(declaredContribution.authorization?.onDemand ?? []),
  ];
  for (const actionId of requestedActions) {
    assert.ok(
      declaredActionIds.has(actionId),
      `${declaredContribution.id} requests undeclared permission ${actionId}.`,
    );
  }
}

const emailOwnerLevel = permissionCatalog.options.levels.find(
  level => level.id === 'email-owner',
);
assert.ok(emailOwnerLevel, 'The default email-owner permission level is required.');
const emailOwnerActions = new Set(emailOwnerLevel.actions);
const surface = contribution('ui.surface', 'tap-email');
assert.ok(surface, 'TAP Email surface contribution is required.');
for (const actionId of [
  ...(surface.authorization.allOf ?? []),
  ...(surface.authorization.onDemand ?? []),
]) {
  assert.ok(
    emailOwnerActions.has(actionId),
    `email-owner must include surface permission ${actionId}.`,
  );
}

const canonicalUserFileActions = new Map([
  ['files.pick-open', {
    resource: 'user-file-picker',
    autonomyCeiling: 'do',
    consent: 'reusable',
    risk: 'read',
  }],
  ['files.read', {
    resource: 'user-selected-files',
    autonomyCeiling: 'listen',
    consent: 'reusable',
    risk: 'read',
  }],
  ['files.pick-save', {
    resource: 'user-file-picker',
    autonomyCeiling: 'do',
    consent: 'reusable',
    risk: 'write',
  }],
  ['files.overwrite', {
    resource: 'user-selected-files',
    autonomyCeiling: 'do',
    consent: 'reusable',
    risk: 'write',
  }],
]);
for (const [actionId, expected] of canonicalUserFileActions) {
  const definitions = permissionCatalog.options.actions.filter(
    action => action.id === actionId,
  );
  assert.equal(
    definitions.length,
    1,
    `${actionId} must have exactly one permission catalog definition.`,
  );
  assert.deepEqual(definitions[0], {
    id: actionId,
    resource: expected.resource,
    scopes: ['user'],
    directActors: ['human'],
    delegatedActors: [],
    autonomyCeiling: expected.autonomyCeiling,
    consent: expected.consent,
    risk: expected.risk,
  });
}
assert.deepEqual(
  surface.authorization.effects.filter(effect => effect.kind === 'user-file'),
  [{ kind: 'user-file', resources: ['pick-open', 'read', 'pick-save', 'overwrite'] }],
  'The surface must bind exactly the user-file effects required by its declared actions.',
);

console.log(
  `manifest.tap.json is a valid SDK ${manifest.compatibility.tapSdk} build descriptor`,
);
