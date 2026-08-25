import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { RsbuildPlugin } from "@rsbuild/core";
import { defineConfig } from "@rslib/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { tapLib } from "@theaiplatform/miniapp-sdk/rspack";

const require = createRequire(import.meta.url);
const reactPackageRoot = dirname(require.resolve("react/package.json"));
const reactDomPackageRoot = dirname(require.resolve("react-dom/package.json"));

const singleReactRuntimePlugin: RsbuildPlugin = {
  name: "agent-browser-prototype:single-react-runtime",
  setup(api) {
    api.modifyBundlerChain((chain) => {
      chain.resolve.alias
        .set("react", reactPackageRoot)
        .set("react-dom", reactDomPackageRoot);
    });
  },
};

if (process.env.ZEPHYR_PUBLISH === "true") {
  throw new Error("The Remote Browser example is intentionally not publishable.");
}

const target = process.env.TAP_PACKAGE_TARGET ?? "desktop";
if (target !== "desktop") {
  throw new Error(`Unsupported Remote Browser target: ${target}`);
}

const library = tapLib({
  manifest: "./manifest.tap.json",
  packageTarget: "desktop",
  packageOutputRoot: ".tap-build/desktop",
  federation: {
    name: "tap_agent_browser_prototype_desktop",
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
library.plugins = [
  ...(library.plugins ?? []),
  singleReactRuntimePlugin,
];

export default defineConfig({ plugins: [pluginReact()], lib: [library] });
