import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
export default defineConfig({
  plugins: [pluginReact()],
  source: { entry: { index: './tests/performance-review.tsx' } },
  html: { title: 'TAP Email performance review — synthetic mailbox' },
  output: { distPath: { root: 'dist-review' } },
});
