import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  // Serve the assembled TAP package so the harness can load the real built
  // federation assets (mf-manifest, expose chunks, manifest.tap.json).
  publicDir: "../.tap-build/desktop",
});
