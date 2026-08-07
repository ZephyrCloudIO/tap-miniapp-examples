import { defineConfig } from "@rslib/core";
import { tapLib } from "@theaiplatform/miniapp-sdk/rspack";
import { rspack } from "@rspack/core";

if (process.env.ZEPHYR_PUBLISH === "true") {
  throw new Error(
    "Build the complete TAP package before publishing; isolated targets cannot be published.",
  );
}

const target = process.env.TAP_PACKAGE_TARGET ?? "desktop";
if (target !== "desktop" && target !== "quickjs") {
  throw new Error(`Unsupported Kart Royale target: ${target}`);
}

// Local validation can point both target compilers at a generated descriptor.
// The default always remains the checked-in production descriptor.
const packageManifest =
  process.env.TAP_PACKAGE_MANIFEST?.trim() || "./manifest.tap.json";
const serverUrl = process.env.KART_ROYALE_SERVER_URL?.trim() || "";

const library = tapLib(
  target === "desktop"
    ? {
        manifest: packageManifest,
        packageTarget: "desktop",
        packageOutputRoot: ".tap-build/desktop",
        federation: {
          name: "tap_kart_royale_desktop",
          filename: "remoteEntry.mjs",
          manifest: true,
          library: { type: "module" },
          dts: false,
          exposes: {
            "./tap/lifecycle": "./src/lifecycle.ts",
            "./ui/desktop": "./src/surface.ts",
          },
        },
      }
    : {
        manifest: packageManifest,
        packageTarget: "quickjs",
        packageOutputRoot: ".tap-build/quickjs",
        federation: {
          name: "tap_kart_royale_quickjs",
          filename: "remoteEntry.mjs",
          manifest: true,
          library: { type: "module" },
          dts: false,
          exposes: {
            "./mcp/kart-royale-state-server": "./src/mcp.mjs",
          },
        },
      },
);

library.source = {
  ...library.source,
  define: {
    ...library.source?.define,
    __KART_ROYALE_SERVER_URL__: JSON.stringify(serverUrl),
  },
};

library.output = {
  ...library.output,
  assetPrefix: target === "desktop" ? "auto" : "",
  sourceMap: false,
  minify: true,
};

if (target === "quickjs") {
  library.tools = {
    ...library.tools,
    rspack(config) {
      config.plugins ??= [];
      config.plugins.push(
        new rspack.CopyRspackPlugin({
          patterns: [
            {
              from: "schemas/race-state-tool-input.json",
              to: "targets/quickjs/schemas/race-state-tool-input.json",
            },
            {
              from: "schemas/race-state-tool-output.json",
              to: "targets/quickjs/schemas/race-state-tool-output.json",
            },
          ],
        }),
      );
    },
  };
}

export default defineConfig({ lib: [library] });
