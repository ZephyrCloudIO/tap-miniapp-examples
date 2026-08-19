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
  name: "model-arena:single-react-runtime",
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
  throw new Error(`Unsupported Model Arena target: ${target}`);
}

const library = lifecycleBuild ? tapLifecycleTarget() : tapLib({
  manifest: "./manifest.tap.json",
  packageTarget: "desktop",
  packageOutputRoot: ".tap-build/desktop",
  federation: {
    name: "tap_model_arena_desktop",
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
library.plugins = [...(library.plugins ?? []), singleReactRuntimePlugin];

export default defineConfig({
  plugins: [pluginReact()],
  lib: [library],
});
