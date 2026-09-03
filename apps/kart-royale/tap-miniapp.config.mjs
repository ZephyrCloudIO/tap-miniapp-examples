import manifest from "./manifest.tap.json" with { type: "json" };
import { defineTapMiniapp } from "@theaiplatform/miniapp-sdk/authoring";
import { commandTargetBuilder } from "@theaiplatform/miniapp-sdk/lifecycle";
import { zephyrPublisher } from "@zephyrcloudio/miniapp-zephyr-publisher";
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
        "./tap/lifecycle": { source: "./src/lifecycle.ts", runtime: "webview" },
        "./ui/desktop": { source: "./src/surface.ts", runtime: "webview" },
      },
      builder,
    },
    quickjs: {
      remoteName: manifest.targets.quickjs.remoteName,
      exposes: {
        "./mcp/kart-royale-state-server": { source: "./src/mcp.mjs", runtime: "quickjs" },
      },
      builder,
    },
  },
  contributions: [staticContributionProvider(manifest)],
  events: manifest.events,
  runtimePolicy: manifest.lifecycle,
  publisher: zephyrPublisher({
    coordinates: { organization: "zephyrcloudio", project: "tap-miniapp-examples", application: "kart-royale" },
  }),
});
