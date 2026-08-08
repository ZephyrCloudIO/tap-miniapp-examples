import { defineConfig } from "@rsbuild/core";
import { withZephyr } from "zephyr-rsbuild-plugin";

// Standalone browser preview. Packaged TAP builds go through rslib.config.mjs
// (tapLib); Zephyr Cloud publishes this preview's module-federation build.
// Unauthenticated builds (local dev, repo CI without ZE tokens) build locally
// and skip the upload.
const publishPreview = process.env.ZEPHYR_PUBLISH === "true";

export default defineConfig({
  plugins: publishPreview ? [withZephyr()] : [],
  source: {
    entry: { index: "./src/preview.ts" },
    // The packaged surface's session-server origin; defaults to the constant
    // in src/net/config.ts. Set once at deploy time, e.g.
    //   KART_ROYALE_SERVER_URL=https://tap-kart-royale-server-production.<acct>.workers.dev pnpm build
    define: {
      __KART_ROYALE_SERVER_URL__: JSON.stringify(
        process.env.KART_ROYALE_SERVER_URL ?? "",
      ),
    },
  },
  html: { title: "Kart Royale", template: "./preview.html" },
  server: { port: 5173, strictPort: true, host: true },
  output: { sourceMap: false, assetPrefix: "auto" },
});
