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
const validate = new Ajv2020({
  allErrors: true,
  strict: false,
  formats: { uint8: true, uint16: true, uint64: true, uri: true },
}).compile(schema);

if (!validate(manifest)) {
  console.error(validate.errors);
  process.exit(1);
}

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
  'specialists/tap-email-specialist/0.1.0.json',
);
assert.deepEqual(mcpServer.options.consumerPolicy.contributionIds, [
  'tap-email-specialist',
]);
for (const id of ['tap-email-mailbox-summary', 'tap-email-active-context']) {
  assert.deepEqual(contribution('mcp.tool', id).options.storageReads, [
    { namespace: 'tap-email', keyTemplate: 'operational/v1' },
  ]);
}

console.log(
  `manifest.tap.json is valid against SDK ${manifest.compatibility.tapSdk} schema`,
);
