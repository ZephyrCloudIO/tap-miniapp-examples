import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const desktopRoot = path.join(packageRoot, '.tap-package', 'targets', 'desktop');
const manifest = JSON.parse(
  await fs.readFile(path.join(desktopRoot, 'mf-manifest.json'), 'utf8'),
);
const sharedNames = (manifest.shared ?? []).map(entry =>
  typeof entry === 'string' ? entry : entry?.name,
);
for (const dependency of ['react', 'react-dom']) {
  if (sharedNames.includes(dependency)) {
    throw new Error(`TAP Email must bundle one private ${dependency} runtime.`);
  }
}
const desktopExpose = (manifest.exposes ?? []).find(
  entry => entry?.path === './ui/desktop',
);
const assets = desktopExpose?.assets?.js?.sync;
if (!Array.isArray(assets) || assets.length === 0) {
  throw new Error('TAP Email desktop expose has no synchronous JavaScript asset.');
}
const sources = await Promise.all(
  assets.map(asset => fs.readFile(path.join(packageRoot, '.tap-package', asset), 'utf8')),
);
const source = sources.join('\n');
if ((source.match(/\.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE=/gu) ?? []).length !== 1) {
  throw new Error('TAP Email desktop expose must contain exactly one React runtime.');
}
if ((source.match(/\.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE=/gu) ?? []).length !== 1) {
  throw new Error('TAP Email desktop expose must contain exactly one React DOM runtime.');
}
console.log('verified one private React/React DOM runtime in TAP Email');
