import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyTapPackage } from '@theaiplatform/miniapp-sdk/rspack';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(packageRoot, '.tap-package');

await verifyTapPackage({ output });
const descriptor = JSON.parse(await readFile(path.join(output, 'tap-miniapp.build.json'), 'utf8'));
const source = JSON.parse(await readFile(path.join(output, 'manifest.tap.json'), 'utf8'));
const artifactPaths = new Set(source.artifacts.map(artifact => artifact.path));
for (const tool of descriptor.contributions.filter(c => c.kind === 'mcp.tool' && c.options.inputSchema)) {
  const schemaPath = tool.options.inputSchema;
  assert.ok(artifactPaths.has(schemaPath), `${tool.id} schema must be in the signed package inventory`);
  const packaged = await readFile(path.join(output, schemaPath), 'utf8');
  const authored = await readFile(path.join(packageRoot, schemaPath.replace('targets/desktop/', '')), 'utf8');
  assert.equal(packaged, authored, `${tool.id} schema must match the authored bytes`);
}
const container = await import(pathToFileURL(path.join(output, descriptor.targets.quickjs.remoteEntry)).href);
await container.init(Object.create(null));
const activity = descriptor.contributions.find(c => c.kind === 'activity.source');
const activityModule = await (await container.get(activity.targets.quickjs.expose))();
assert.deepEqual(Object.keys(activityModule), ['activitySource']);
assert.equal(typeof activityModule.activitySource.get, 'function');
await assert.rejects(() => activityModule.activitySource.get({ scope: 'workspace' }), /trusted self scope/);
console.log(`verified SDK 0.19 package, signed live-tool schemas, and activity source ABI at ${output}`);
