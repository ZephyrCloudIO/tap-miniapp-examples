import { defineConfig } from "@rslib/core";
import { tapLib } from "@theaiplatform/miniapp-sdk/rspack";

if (process.env.ZEPHYR_PUBLISH === "true") throw new Error("Build the complete TAP package before publishing.");
const target = process.env.TAP_PACKAGE_TARGET ?? "desktop";
if (target !== "desktop") throw new Error(`Unsupported player target: ${target}`);

const library = tapLib({
  manifest: "./manifest.tap.json", packageTarget: "desktop", packageOutputRoot: ".tap-build/desktop",
  federation: {
    name: "tap_unofficial_suno_player_desktop", filename: "remoteEntry.mjs", manifest: true,
    library: { type: "module" }, dts: false,
    exposes: { "./tap/lifecycle": "./src/lifecycle.ts", "./ui/desktop": "./src/surface.tsx" },
  },
});
library.output = { ...library.output, assetPrefix: "auto", sourceMap: false, minify: true };
export default defineConfig({ lib: [library] });
