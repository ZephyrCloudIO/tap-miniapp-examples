import manifest from "./manifest.tap.json" with { type: "json" };
import { defineTapMiniapp } from "@theaiplatform/miniapp-sdk/authoring";
import { commandTargetBuilder } from "@theaiplatform/miniapp-sdk/lifecycle";
import { zephyrPublisher } from "@zephyrcloudio/miniapp-zephyr-publisher";
import { staticContributionProvider } from "../../scripts/tap-miniapp-static-contributions.mjs";
import { verifyLiveMcpContract } from "./scripts/verify-live-mcp-contract.mjs";
import { verifySingleReactRuntime } from "./scripts/verify-react-runtime.mjs";

const builder = commandTargetBuilder({
  command: "pnpm",
  args: ["run", "build:target"],
});

export default defineTapMiniapp({
  versionLabel: manifest.release.version,
  presentation: {
    ...manifest.presentation,
    slug: manifest.package.slug,
  },
  compatibility: { tapHost: manifest.compatibility.tapHost },
  targets: {
    desktop: {
      remoteName: manifest.targets.desktop.remoteName,
      exposes: {
        "./tap/lifecycle": {
          source: "./src/lifecycle.ts",
          runtime: "webview",
        },
        "./ui/desktop": {
          source: "./src/surface.tsx",
          runtime: "webview",
        },
      },
      builder,
    },
    quickjs: {
      remoteName: manifest.targets.quickjs.remoteName,
      exposes: {
        "./activity/tap-calendar-committed-actions": { source: "./src/activity-source.ts", runtime: "quickjs" },
        "./mcp/calendar-tools": {
          source: "./src/mcp/calendar-tools-entry.ts",
          runtime: "quickjs",
        },
        "./mcp/calendar-daily-summary": {
          source: "./src/mcp/daily-summary-tools-entry.ts",
          runtime: "quickjs",
        },
      },
      builder,
    },
    "workflow-host": {
      remoteName: manifest.targets["workflow-host"].remoteName,
      exposes: {
        "./workflow-host/catalog": {
          source: "./src/workflow-host/catalog.ts",
          runtime: "workflow-host",
        },
      },
      builder,
    },
  },
  contributions: [staticContributionProvider(manifest)],
  events: manifest.events,
  runtimePolicy: manifest.lifecycle,
  publisher: zephyrPublisher({
    coordinates: {
      organization: "zephyrcloudio",
      project: "tap-miniapp-examples",
      application: "tap-calendar",
    },
  }),
  verify: {
    verifyRuntime: async ({ packageRoot }) => {
      await verifySingleReactRuntime(packageRoot);
      await verifyLiveMcpContract(packageRoot);
    },
  },
});
