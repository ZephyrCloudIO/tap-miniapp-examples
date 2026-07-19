import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assembleTapPackage,
  assertPortableTapPackageArtifacts,
} from '@theaiplatform/miniapp-sdk/rspack';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(packageRoot, '.tap-package');

await assembleTapPackage({
  manifest: path.join(packageRoot, 'manifest.tap.json'),
  output,
  targets: {
    desktop: path.join(packageRoot, '.tap-build/desktop'),
    quickjs: path.join(packageRoot, '.tap-build/quickjs'),
  },
});

await assertPortableTapPackageArtifacts({
  output,
  forbiddenRoots: [packageRoot],
});

console.log(`Assembled portable TAP package at ${output}`);
