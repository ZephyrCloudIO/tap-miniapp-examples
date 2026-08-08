import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { RsbuildPlugin } from "@rsbuild/core";
import { defineConfig } from "@rslib/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { tapLib, tapLifecycleTarget } from "@theaiplatform/miniapp-sdk/rspack";

const require = createRequire(import.meta.url);
const reactPackageRoot = dirname(require.resolve("react/package.json"));
const reactDomPackageRoot = dirname(
  require.resolve("react-dom/package.json"),
);

const singleReactRuntimePlugin: RsbuildPlugin = {
  name: "family-task-board:single-react-runtime",
  setup(api) {
    api.modifyBundlerChain((chain) => {
      chain.resolve.alias
        .set("react", reactPackageRoot)
        .set("react-dom", reactDomPackageRoot);
    });
  },
};

if (process.env.ZEPHYR_PUBLISH === "true") {
  throw new Error(
    "Build the complete TAP package before publishing; isolated targets cannot be published.",
  );
}

const lifecycleBuild = Boolean(process.env.TAP_MINIAPP_TARGET);
const target = process.env.TAP_MINIAPP_TARGET ?? process.env.TAP_PACKAGE_TARGET ?? "desktop";
if (target !== "desktop") {
  throw new Error(`Unsupported Family Task Board target: ${target}`);
}

const library = lifecycleBuild ? tapLifecycleTarget() : tapLib({
  manifest: "./manifest.tap.json",
  packageTarget: "desktop",
  packageOutputRoot: ".tap-build/desktop",
  federation: {
    name: "tap_family_task_board_desktop",
    filename: "remoteEntry.mjs",
    manifest: true,
    library: { type: "module" },
    dts: false,
    exposes: {
      "./tap/lifecycle": "./src/lifecycle.ts",
      "./ui/desktop": "./src/surface.tsx",
    },
  },
});

library.output = {
  ...library.output,
  assetPrefix: "auto",
  sourceMap: false,
  minify: true,
};
// The SDK's published UI entry keeps React external. pnpm exposes that peer
// through the SDK's virtual-store path, while this app imports React through
// its workspace path. Rspack otherwise treats those paths as two modules in the
// isolated remote even though they resolve to the same package, leaving SDK UI
// hooks attached to a dispatcher that ReactDOM never activates.
library.plugins = [...(library.plugins ?? []), singleReactRuntimePlugin];

export default defineConfig({
  plugins: [pluginReact()],
  lib: [library],
});
