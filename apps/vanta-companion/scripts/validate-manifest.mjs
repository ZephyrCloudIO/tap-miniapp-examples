import fs from 'node:fs';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(
  fs.readFileSync(
    new URL(
      '../node_modules/@theaiplatform/miniapp-sdk/config-schema.json',
      import.meta.url,
    ),
  ),
);
const manifest = JSON.parse(
  fs.readFileSync(new URL('../manifest.tap.json', import.meta.url)),
);
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addFormat('uint16', {
  type: 'number',
  validate: value => Number.isInteger(value) && value >= 0 && value <= 65_535,
});
ajv.addFormat('uint64', {
  type: 'number',
  validate: value => Number.isSafeInteger(value) && value >= 0,
});
ajv.addFormat('uri', {
  type: 'string',
  validate: value => {
    try {
      return Boolean(new URL(value));
    } catch {
      return false;
    }
  },
});
if (!ajv.validate(schema, manifest)) {
  console.error(ajv.errors);
  process.exit(1);
}

const regions = [
  ['us', 'https://mcp.vanta.com/mcp'],
  ['eu', 'https://mcp.eu.vanta.com/mcp'],
  ['aus', 'https://mcp.aus.vanta.com/mcp'],
];
for (const [region, endpoint] of regions) {
  const slug = `vanta-soc2-companion-${region}`;
  const assetPath = `specialists/${slug}/0.1.0.json`;
  const contribution = manifest.contributions.find(
    candidate => candidate.kind === 'specialist' && candidate.id === slug,
  );
  assert.ok(contribution, `Missing ${region.toUpperCase()} specialist contribution.`);
  assert.deepEqual(contribution.targets, {
    desktop: { runtime: 'host-declarative' },
  });
  assert.equal(contribution.lifecycleScope, 'installation');
  assert.equal(contribution.options?.manifest, assetPath);
  const asset = JSON.parse(
    fs.readFileSync(new URL(`../${assetPath}`, import.meta.url), 'utf8'),
  );
  assert.equal(asset.name, slug);
  assert.equal(asset.version, '0.1.0');
  assert.equal(asset.schemaVersion, '1.3.0');
  assert.equal(asset.tooling?.mcpTemplates?.length, 1);
  const template = asset.tooling.mcpTemplates[0];
  assert.equal(template.transport?.type, 'streamableHttp');
  assert.equal(template.transport?.url, endpoint);
  assert.equal(template.required, true);
  assert.equal(template.preferScope, 'workspace');
  assert.equal(template.tools?.length, 45);
  assert.equal(new Set(template.tools).size, 45);
  assert.deepEqual(template.toolPolicy?.allowedTools, template.tools);
  assert.equal(template.toolPolicy?.default, 'allowlistOnly');
  assert.deepEqual(template.toolPolicy?.blockedTools, []);
  assert.deepEqual(template.toolPolicy?.writeToolPatterns, []);
}

const descriptorText = JSON.stringify(manifest);
assert.equal(descriptorText.includes('specialists.manage'), false);
assert.equal(descriptorText.includes('tap.specialists:manage'), false);

console.log('manifest.tap.json and regional package specialists are valid');
