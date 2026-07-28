import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig } from "@rslib/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { tapLib } from "@theaiplatform/miniapp-sdk/rspack";

const require = createRequire(import.meta.url);

if (process.env.ZEPHYR_PUBLISH === "true") {
  throw new Error("Build the complete TAP package before publishing.");
}

const target = process.env.TAP_PACKAGE_TARGET ?? "desktop";
if (target !== "desktop" && target !== "quickjs") {
  throw new Error(`Unsupported Pyre target: ${target}`);
}

const library = tapLib(
  target === "desktop"
    ? {
        manifest: "./manifest.tap.json",
        packageTarget: "desktop",
        packageOutputRoot: ".tap-build/desktop",
        federation: {
          name: "tap_pyre_desktop",
          filename: "remoteEntry.mjs",
          manifest: true,
          library: { type: "module" },
          dts: false,
          exposes: {
            "./tap/lifecycle": "./src/lifecycle.ts",
            "./ui/desktop": "./src/surface.tsx",
            "./specialists/pyre": "./src/specialist.ts",
          },
        },
      }
    : {
        manifest: "./manifest.tap.json",
        packageTarget: "quickjs",
        packageOutputRoot: ".tap-build/quickjs",
        federation: {
          name: "tap_pyre_quickjs",
          filename: "remoteEntry.mjs",
          manifest: true,
          library: { type: "module" },
          dts: false,
          exposes: {
            "./mcp/pyre-mcp": "./src/mcp.ts",
          },
        },
      },
);
library.output = {
  ...library.output,
  assetPrefix: target === "desktop" ? "auto" : "",
  sourceMap: false,
  minify: true,
};
if (target === "desktop") {
  const configuredRspack = library.tools?.rspack;
  const rspackTools =
    typeof configuredRspack === "object" &&
    configuredRspack !== null &&
    !Array.isArray(configuredRspack)
      ? configuredRspack
      : {};
  library.tools = {
    ...library.tools,
    rspack: {
      ...rspackTools,
      resolve: {
        ...rspackTools.resolve,
        alias: {
          ...rspackTools.resolve?.alias,
          react: path.dirname(require.resolve("react/package.json")),
          "react-dom": path.dirname(require.resolve("react-dom/package.json")),
        },
      },
    },
  };
}

export default defineConfig({
  plugins: target === "desktop" ? [pluginReact()] : [],
  lib: [library],
});
