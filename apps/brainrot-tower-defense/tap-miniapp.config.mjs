import manifest from "./manifest.tap.json" with { type: "json" };
import { defineTapMiniapp } from "@theaiplatform/miniapp-sdk/authoring";
import { commandTargetBuilder } from "@theaiplatform/miniapp-sdk/lifecycle";
import { staticContributionProvider } from "../../scripts/tap-miniapp-static-contributions.mjs";

const builder = commandTargetBuilder({
  command: "pnpm",
  args: ["run", "build:lifecycle-target"],
});

export default defineTapMiniapp({
  versionLabel: manifest.release.version,
  presentation: { ...manifest.presentation, slug: manifest.package.slug, categories: ["other"] },
  compatibility: { tapHost: manifest.compatibility.tapHost },
  targets: {
    desktop: {
      remoteName: manifest.targets.desktop.remoteName,
      exposes: {
        "./tap/lifecycle": { source: "./src/lifecycle.mjs", runtime: "webview" },
        "./ui/desktop": { source: "./src/surface.mjs", runtime: "webview" },
      },
      builder,
    },
    quickjs: {
      remoteName: manifest.targets.quickjs.remoteName,
      exposes: {
        "./mcp/brainrot-td-state-server": { source: "./src/mcp.mjs", runtime: "quickjs" },
      },
      builder,
    },
  },
  contributions: [staticContributionProvider(manifest)],
  events: manifest.events,
  runtimePolicy: manifest.lifecycle,
});
