import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { emailBuild, archiveSourceMaps } from './diagnostic-build';

export default defineConfig({
  plugins: [pluginReact(), archiveSourceMaps('preview')],
  source: {
    entry: { index: './src/preview.tsx' },
    define: { __TAP_EMAIL_BUILD__: JSON.stringify(emailBuild) },
  },
  html: { title: 'TAP Email — Keyboard-first email' },
  output: { sourceMap: { js: 'hidden-source-map', css: false } },
});
