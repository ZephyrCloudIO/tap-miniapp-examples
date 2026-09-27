import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
  source: { entry: { index: './tests/interactive/app.tsx' } },
  html: { title: 'Email interactive renderer fixture' },
  output: { assetPrefix: './', distPath: { root: 'dist-interactive' } },
});
