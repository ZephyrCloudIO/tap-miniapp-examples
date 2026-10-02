import { defineConfig } from "@rslib/core";
import { tapLib, tapLifecycleTarget } from "@theaiplatform/miniapp-sdk/rspack";

if (process.env.ZEPHYR_PUBLISH === "true") {
  throw new Error("Build the complete TAP package before publishing.");
}

const lifecycleBuild = Boolean(process.env.TAP_MINIAPP_TARGET);
const requestedTarget = process.env.TAP_MINIAPP_TARGET ?? process.env.TAP_PACKAGE_TARGET ?? "desktop";
if (requestedTarget !== "desktop") {
  throw new Error(`Unsupported PR Radar package target: ${requestedTarget}`);
}

const federation = {
  name: "tap_github_notify_desktop",
  filename: "remoteEntry.mjs",
  manifest: true,
  library: { type: "module" as const },
  dts: false,
  exposes: {
    "./tap/lifecycle": "./src/lifecycle.ts",
    "./ui/desktop": "./src/ui/desktop.ts",
  },
};

const library = lifecycleBuild
  ? tapLifecycleTarget()
  : tapLib({
      manifest: "./manifest.tap.json",
      packageTarget: "desktop",
      packageOutputRoot: ".tap-build/desktop",
      federation,
    });

library.output = {
  ...library.output,
  assetPrefix: "auto",
  sourceMap: false,
  minify: {
    js: true,
    jsOptions: {
      minimizerOptions: {
        mangle: { toplevel: true },
        module: true,
      },
    },
  },
};

export default defineConfig({ lib: [library] });
