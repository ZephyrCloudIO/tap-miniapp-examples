import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyTapPackage } from '@theaiplatform/miniapp-sdk/rspack';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(packageRoot, '.tap-package');

await verifyTapPackage({ output });
console.log(`verified SDK generation-2 TAP package at ${output}`);
