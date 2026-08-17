import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";
import type { RsbuildPlugin } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { defineConfig } from "@rslib/core";
import {
  tapLib,
  tapLifecycleTarget,
} from "@theaiplatform/miniapp-sdk/rspack";

const require = createRequire(import.meta.url);
const reactPackageRoot = dirname(require.resolve("react/package.json"));
const reactDomPackageRoot = dirname(require.resolve("react-dom/package.json"));
const calendarGatewayUrl =
  process.env.TAP_CALENDAR_GATEWAY_URL?.trim() ||
  "https://calendar-api.theaiplatform.app";

const singleReactRuntimePlugin: RsbuildPlugin = {
  name: "tap-calendar:single-react-runtime",
  setup(api) {
    api.modifyBundlerChain((chain) => {
      chain.resolve.alias
        .set("react", reactPackageRoot)
        .set("react-dom", reactDomPackageRoot);
    });
  },
};

if (process.env.ZEPHYR_PUBLISH === "true") {
  throw new Error("Build the complete TAP Calendar package before publishing.");
}

const targetConfigurations = {
  desktop: {
    name: "tap_tap_calendar_desktop",
    exposes: {
      "./tap/lifecycle": "./src/lifecycle.ts",
      "./ui/desktop": "./src/surface.tsx",
    },
  },
  quickjs: {
    name: "tap_tap_calendar_quickjs",
    exposes: {
      "./mcp/calendar-tools": "./src/mcp/calendar-tools-entry.ts",
      "./mcp/calendar-daily-summary": "./src/mcp/daily-summary-tools-entry.ts",
    },
  },
  "workflow-host": {
    name: "tap_tap_calendar_workflow_host",
    exposes: {
      "./workflow-host/catalog": "./src/workflow-host/catalog.ts",
    },
  },
} as const;

type PackageTarget = keyof typeof targetConfigurations;
const lifecycleBuild = Boolean(process.env.TAP_MINIAPP_TARGET);
const requestedTarget =
  process.env.TAP_MINIAPP_TARGET ??
  process.env.TAP_PACKAGE_TARGET ??
  "desktop";
if (!Object.hasOwn(targetConfigurations, requestedTarget)) {
  throw new Error(`Unsupported TAP Calendar target: ${requestedTarget}`);
}
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

const workflowSchemaAssets = [
  "empty-config.schema.json",
  "booking-created-input.schema.json",
  "booking-cancelled-input.schema.json",
  "normalized-booking.schema.json",
  "work-block-request.schema.json",
  "work-block-draft.schema.json",
  "channel-summary.schema.json",
] as const;

const workflowSchemaAssetPlugin = (
  schemaAssets: readonly string[],
): RsbuildPlugin => ({
  name: "tap-calendar:workflow-schema-assets",
  setup(api) {
    api.processAssets(
      { stage: "additional" },
      async ({ compilation, sources }) => {
        for (const name of schemaAssets) {
          const sourcePath = resolve("workflow-schemas", name);
          const contents = await readFile(sourcePath);
          const assetPath = `targets/workflow-host/schemas/${name}`;
          compilation.fileDependencies.add(sourcePath);
          compilation.emitAsset(assetPath, new sources.RawSource(contents));
        }
      },
    );
  },
});

const library = lifecycleBuild
  ? tapLifecycleTarget()
  : tapLib({
      manifest: "./manifest.tap.json",
      packageTarget,
      packageOutputRoot: `.tap-build/${packageTarget}`,
      federation,
    });

if (packageTarget === "workflow-host") {
  const targetDirectory = "targets/workflow-host";
  library.plugins = [
    ...(library.plugins ?? []).filter(
      (plugin) =>
        typeof plugin !== "object" ||
        plugin === null ||
        !("name" in plugin) ||
        plugin.name !== "rsbuild:module-federation-enhanced",
    ),
    pluginModuleFederation(
      {
        ...federation,
        filename: `${targetDirectory}/remoteEntry.mjs`,
        manifest: { filePath: targetDirectory },
      },
      { target: "web" },
    ),
    workflowSchemaAssetPlugin(workflowSchemaAssets),
  ];
}

library.output = {
  ...library.output,
  assetPrefix: packageTarget === "desktop" ? "auto" : "",
  sourceMap: false,
  minify: true,
};
if (packageTarget === "desktop") {
  library.plugins = [...(library.plugins ?? []), singleReactRuntimePlugin];
}

export default defineConfig({
  plugins: packageTarget === "desktop" ? [pluginReact()] : [],
  source: {
    define: {
      __TAP_CALENDAR_GATEWAY_URL__: JSON.stringify(
        calendarGatewayUrl,
      ),
      __TAP_CALENDAR_LEGACY_OWNER_PRINCIPAL_ID__: JSON.stringify(
        process.env.TAP_CALENDAR_LEGACY_OWNER_PRINCIPAL_ID ?? "",
      ),
    },
  },
  lib: [library],
});
