import { defineConfig } from '@rslib/core';
import { tapLib } from '@theaiplatform/miniapp-sdk/rspack';
if (process.env.ZEPHYR_PUBLISH === 'true')
  throw new Error('Build the complete TAP package before publishing.');
const target = process.env.TAP_PACKAGE_TARGET ?? 'desktop';
if (target !== 'desktop' && target !== 'quickjs')
  throw new Error(`Unsupported Personal Health Ledger target: ${target}`);
const library = tapLib(
  target === 'desktop'
    ? {
        manifest: './manifest.tap.json',
        packageTarget: 'desktop',
        packageOutputRoot: '.tap-build/desktop',
        federation: {
          name: 'tap_personal_health_ledger_desktop',
          filename: 'remoteEntry.mjs',
          manifest: true,
          library: { type: 'module' },
          dts: false,
          exposes: {
            './tap/lifecycle': './src/lifecycle.ts',
            './ui/desktop': './src/surface.tsx',
            './specialists/health': './src/specialist.ts',
          },
        },
      }
    : {
        manifest: './manifest.tap.json',
        packageTarget: 'quickjs',
        packageOutputRoot: '.tap-build/quickjs',
        federation: {
          name: 'tap_personal_health_ledger_quickjs',
          filename: 'remoteEntry.mjs',
          manifest: true,
          library: { type: 'module' },
          dts: false,
          exposes: {
            './mcp/administration': './src/mcp/administration.ts',
          },
        },
      },
);
library.output = {
  ...library.output,
  assetPrefix: 'auto',
  sourceMap: false,
  minify: true,
};
export default defineConfig({ lib: [library] });
