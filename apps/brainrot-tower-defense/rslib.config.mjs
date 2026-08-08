import { defineConfig } from "@rslib/core";
import { tapLib, tapLifecycleTarget } from "@theaiplatform/miniapp-sdk/rspack";
import { rspack } from "@rspack/core";

const lifecycleBuild = Boolean(process.env.TAP_MINIAPP_TARGET);
const target = process.env.TAP_MINIAPP_TARGET ?? process.env.TAP_PACKAGE_TARGET ?? "desktop";
if (target !== "desktop" && target !== "quickjs") {
  throw new Error(`Unsupported Brainrot Tower Defense target: ${target}`);
}

const library = lifecycleBuild
  ? tapLifecycleTarget()
  : tapLib(
    target === "desktop"
    ? {
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
            "./ui/desktop": "./src/surface.mjs"
          }
        }
      }
    : {
        manifest: "./manifest.tap.json",
        packageTarget: "quickjs",
        packageOutputRoot: ".tap-build/quickjs",
        federation: {
          name: "tap_brainrot_tower_defense_quickjs",
          filename: "remoteEntry.mjs",
          manifest: true,
          library: { type: "module" },
          dts: false,
          exposes: {
            "./mcp/brainrot-td-state-server": "./src/mcp.mjs"
          }
        }
      },
  );
library.output = {
  ...library.output,
  assetPrefix: target === "desktop" ? "auto" : "",
  sourceMap: false,
  minify: true
};
library.tools = {
  ...library.tools,
  rspack(config) {
    if (target === "desktop") {
      config.experiments = { ...config.experiments, asyncWebAssembly: true };
    }
    config.plugins ??= [];
    config.plugins.push(new rspack.CopyRspackPlugin({
      patterns:
        target === "desktop"
          ? [
              {
                from: "schemas/checkpoint.json",
                to: "targets/desktop/schemas/checkpoint.json"
              }
            ]
          : [
              {
                from: "schemas/game-state-tool-input.json",
                to: "targets/quickjs/schemas/game-state-tool-input.json"
              },
              {
                from: "schemas/game-state-tool-output.json",
                to: "targets/quickjs/schemas/game-state-tool-output.json"
              }
            ]
    }));
  }
};
export default defineConfig({ lib: [library] });
