import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const artifactRoots = process.argv.slice(2);

if (artifactRoots.length === 0) {
  throw new Error('Pass at least one assembled artifact directory to inspect.');
}

const forbiddenMarkers = ['localhost:8787', 'TAP Email (Local Dev)'];
const requiredMarker = 'tap-email-coordinator.theaiplatform.app';
const matches = {
  forbidden: [],
  required: [],
};

async function inspect(path) {
  const entries = await readdir(path, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(path, entry.name);

      if (entry.isDirectory()) {
        await inspect(entryPath);
        return;
      }

      if (!entry.isFile()) return;

      const contents = await readFile(entryPath, 'utf8');
      if (forbiddenMarkers.some((marker) => contents.includes(marker))) {
        matches.forbidden.push(entryPath);
      }
      if (contents.includes(requiredMarker)) {
        matches.required.push(entryPath);
      }
    }),
  );
}

await Promise.all(artifactRoots.map(inspect));

if (matches.forbidden.length > 0) {
  console.error(
    `The assembled package contains a local development marker in:\n${matches.forbidden.join('\n')}`,
  );
  process.exitCode = 1;
} else if (matches.required.length === 0) {
  console.error(
    `The assembled package does not contain the production coordinator origin: ${requiredMarker}`,
  );
  process.exitCode = 1;
} else {
  console.log(`Verified production coordinator origin in ${matches.required.length} artifact file(s).`);
}
