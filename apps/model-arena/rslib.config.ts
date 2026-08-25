import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { RsbuildPlugin } from "@rsbuild/core";
import { defineConfig } from "@rslib/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { tapLifecycleTarget } from "@theaiplatform/miniapp-sdk/rspack";

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

const library = tapLifecycleTarget();

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
