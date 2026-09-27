import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { emailBuild, archiveSourceMaps } from './diagnostic-build';

export default defineConfig({
  plugins: [pluginReact(), archiveSourceMaps('harness')],
  source: {
    entry: { index: './tests/diagnostics/app.tsx' },
    define: { __TAP_EMAIL_BUILD__: JSON.stringify(emailBuild) },
  },
  html: { title: 'Email diagnostics fixture' },
  output: { distPath: { root: 'dist-diagnostics' }, sourceMap: { js: 'hidden-source-map', css: false } },
});
