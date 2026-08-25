import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  // SDK 0.12 assembles the verified, importable TAP package into dist/. Serve
  // that package so the harness exercises its real manifest and federation
  // assets rather than the lifecycle's temporary per-target build directory.
  publicDir: "../dist",
});
