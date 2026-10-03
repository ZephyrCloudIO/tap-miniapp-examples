import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
export default defineConfig({
  plugins: [pluginReact()],
  source: { entry: { index: './tests/reader-benchmark.tsx', scroll: './tests/scroll-benchmark.tsx',
    panel: './tests/panel-height-benchmark.tsx' } },
  html: { title: 'Email synthetic HTML reader benchmark' },
  output: { distPath: { root: 'dist-reader-after' } },
});
