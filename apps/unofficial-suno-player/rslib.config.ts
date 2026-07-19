import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";
import type { RsbuildPlugin } from "@rsbuild/core";
import { defineConfig } from "@rslib/core";
import { tapLib } from "@theaiplatform/miniapp-sdk/rspack";

if (process.env.ZEPHYR_PUBLISH === "true") throw new Error("Build the complete TAP package before publishing.");

const targetConfigurations = {
  desktop: {
    name: "tap_unofficial_suno_player_desktop",
    exposes: {
      "./tap/lifecycle": "./src/lifecycle.ts",
      "./ui/desktop": "./src/surface.tsx",
    },
  },
  "workflow-host": {
    name: "tap_unofficial_suno_player_workflow_host",
    exposes: {
      "./tap/lifecycle": "./src/lifecycle.ts",
      "./workflow-host/catalog": "./src/workflow-host/catalog.ts",
    },
  },
} as const;

type PackageTarget = keyof typeof targetConfigurations;
const requestedTarget = process.env.TAP_PACKAGE_TARGET ?? "desktop";
if (!Object.hasOwn(targetConfigurations, requestedTarget)) throw new Error(`Unsupported player target: ${requestedTarget}`);
const packageTarget = requestedTarget as PackageTarget;
const targetConfiguration = targetConfigurations[packageTarget];
const federation = {
  name: targetConfiguration.name,
  filename: "remoteEntry.mjs",
  manifest: true,
  library: { type: "module" as const },
  dts: false,
  exposes: targetConfiguration.exposes,
};

const workflowSchemaAssetPlugin = (schemaAssets: readonly string[]): RsbuildPlugin => ({
  name: "tap:workflow-schema-assets",
  setup(api) {
    api.processAssets({ stage: "additional" }, async ({ compilation, sources }) => {
      for (const name of schemaAssets) {
        const sourcePath = resolve("workflow-schemas", name);
        const contents = await readFile(sourcePath);
        const assetPath = `targets/workflow-host/schemas/${name}`;
        compilation.fileDependencies.add(sourcePath);
        compilation.emitAsset(assetPath, new sources.RawSource(contents));
      }
    });
  },
});

const library = tapLib({
  manifest: "./manifest.tap.json",
  packageTarget,
  packageOutputRoot: `.tap-build/${packageTarget}`,
  federation,
});

if (packageTarget === "workflow-host") {
  const targetDirectory = "targets/workflow-host";
  const schemaAssets = [
    "manual-brief-workflow.schema.json",
    "manual-brief-node-config.schema.json",
  ];
  library.plugins = [
    ...(library.plugins ?? []).filter(
      (plugin) => typeof plugin !== "object" || plugin === null || !("name" in plugin) || plugin.name !== "rsbuild:module-federation-enhanced",
    ),
    pluginModuleFederation(
      {
        ...federation,
        filename: `${targetDirectory}/remoteEntry.mjs`,
        manifest: { filePath: targetDirectory },
      },
      { target: "web" },
    ),
    workflowSchemaAssetPlugin(schemaAssets),
  ];
}

library.output = {
  ...library.output,
  assetPrefix: packageTarget === "desktop" ? "auto" : "",
  sourceMap: false,
  minify: true,
};

export default defineConfig({ lib: [library] });
