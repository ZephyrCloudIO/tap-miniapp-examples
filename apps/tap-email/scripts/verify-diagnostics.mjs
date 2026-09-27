import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('..', import.meta.url));
const packageRoot = path.join(app, '.tap-package');
const files = await readdir(packageRoot, { recursive: true });
if (files.some(file => file.endsWith('.map'))) throw new Error('Source maps must be archived separately from the TAP package.');
let count = 0;
for (const target of ['desktop', 'quickjs']) {
  const directory = path.join(app, '.tap-diagnostics', target);
  const index = JSON.parse(await readFile(path.join(directory, 'index.json'), 'utf8'));
  if (!index.maps?.length) throw new Error(`Missing archived ${target} source maps.`);
  for (const entry of index.maps) {
    const bytes = await readFile(path.join(packageRoot, entry.asset));
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== entry.sha256) throw new Error(`Source map does not match the packaged bundle: ${entry.asset}`);
    const map = JSON.parse(await readFile(path.join(directory, entry.map), 'utf8'));
    if (map.version !== 3 || !map.sources?.length) throw new Error(`Invalid source map: ${entry.map}`);
    if (/sourceMappingURL\s*=/u.test(bytes.toString())) throw new Error(`Unexpected runtime source map reference: ${entry.asset}`);
    count += 1;
  }
}
console.log(`Verified ${count} archived source maps against the exact package bytes; no maps included in the runtime package.`);
