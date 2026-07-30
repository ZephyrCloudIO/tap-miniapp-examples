import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { RsbuildPlugin } from '@rsbuild/core';
import { defineConfig } from '@rslib/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { tapLib } from '@theaiplatform/miniapp-sdk/rspack';

const require = createRequire(import.meta.url);
const reactPackageRoot = dirname(require.resolve('react/package.json'));
const reactDomPackageRoot = dirname(
  require.resolve('react-dom/package.json'),
);

const singleReactRuntimePlugin: RsbuildPlugin = {
  name: 'personal-health-ledger:single-react-runtime',
  setup(api) {
    api.modifyBundlerChain(chain => {
      chain.resolve.alias
        .set('react', reactPackageRoot)
        .set('react-dom', reactDomPackageRoot);
    });
  },
};

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
  // QuickJS evaluates the verified package graph without a browser document or
  // currentScript. Keep automatic public-path discovery only for the webview.
  assetPrefix: target === 'desktop' ? 'auto' : '',
  sourceMap: false,
  minify: true,
};
if (target === 'desktop') {
  // The SDK UI keeps React external. With pnpm, that peer can resolve through
  // the SDK's virtual-store path while the app resolves the workspace path,
  // producing two bundled dispatchers. Canonicalize both import graphs.
  library.plugins = [
    ...(library.plugins ?? []),
    singleReactRuntimePlugin,
  ];
}
export default defineConfig({
  plugins: target === 'desktop' ? [pluginReact()] : [],
  lib: [library],
});
