import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
  source: { entry: { index: './src/preview.tsx' } },
  html: { title: 'TAP Email — Keyboard-first email' },
  output: { sourceMap: false },
});
