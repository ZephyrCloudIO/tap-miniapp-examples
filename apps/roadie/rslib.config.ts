import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { RsbuildPlugin } from "@rsbuild/core";
import { defineConfig } from "@rslib/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { tapLib } from "@theaiplatform/miniapp-sdk/rspack";
import { withZephyr } from "zephyr-rsbuild-plugin";

const require = createRequire(import.meta.url);
const reactPackageRoot = dirname(require.resolve("react/package.json"));
const reactDomPackageRoot = dirname(require.resolve("react-dom/package.json"));
const singleReactRuntimePlugin: RsbuildPlugin = {
  name: "roadie:single-react-runtime",
  setup(api) {
    api.modifyBundlerChain((chain) => {
      chain.resolve.alias.set("react", reactPackageRoot).set("react-dom", reactDomPackageRoot);
    });
  },
};

const library = tapLib({
  manifest: "./manifest.tap.json",
  packageTarget: "desktop",
  packageOutputRoot: ".tap-build/desktop",
  federation: {
    name: "tap_roadie_desktop",
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
  plugins: [
    pluginReact(),
    ...(process.env.ZEPHYR_DEPLOY === "true" ? [withZephyr()] : []),
  ],
  lib: [library],
});
