import { defineConfig } from "@rslib/core";
import { tapLib } from "@theaiplatform/miniapp-sdk/rspack";
import { rspack } from "@rspack/core";

const library = tapLib({
  manifest: "./manifest.tap.json",
  packageTarget: "desktop",
  packageOutputRoot: ".tap-build/desktop",
  federation: {
    name: "tap_brainrot_tower_defense_desktop",
    filename: "remoteEntry.mjs",
    manifest: true,
    library: { type: "module" },
    dts: false,
    exposes: {
      "./tap/lifecycle": "./src/lifecycle.mjs",
      "./ui/desktop": "./src/surface.mjs",
      "./mcp/brainrot-td-state-server": "./src/mcp.mjs"
    }
  }
});
library.output = { ...library.output, assetPrefix: "auto", sourceMap: false, minify: true };
library.tools = {
  ...library.tools,
  rspack(config) {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    config.plugins ??= [];
    config.plugins.push(new rspack.CopyRspackPlugin({
      patterns: [{ from: "schemas", to: "schemas" }]
    }));
  }
};
export default defineConfig({ lib: [library] });
