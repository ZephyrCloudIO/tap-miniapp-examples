import manifest from "./manifest.tap.json" with { type: "json" };
import { defineTapMiniapp } from "@theaiplatform/miniapp-sdk/authoring";
import { commandTargetBuilder } from "@theaiplatform/miniapp-sdk/lifecycle";
import { staticContributionProvider } from "../../scripts/tap-miniapp-static-contributions.mjs";

const builder = commandTargetBuilder({
  command: "pnpm",
  args: ["exec", "rslib", "build"],
});

export default defineTapMiniapp({
  release: { version: manifest.release.version },
  identity: manifest.package,
  presentation: manifest.presentation,
  compatibility: { tapHost: manifest.compatibility.tapHost },
  targets: {
    desktop: {
      remoteName: manifest.targets.desktop.remoteName,
      exposes: {
        "./tap/lifecycle": { source: "./src/lifecycle.ts", runtime: "webview" },
        "./ui/desktop": { source: "./src/surface.tsx", runtime: "webview" },
      },
      builder,
    },
    quickjs: {
      remoteName: manifest.targets.quickjs.remoteName,
      exposes: {
        "./mcp/administration": { source: "./src/mcp/administration.ts", runtime: "quickjs" },
      },
      builder,
    },
  },
  contributions: [staticContributionProvider(manifest)],
  events: manifest.events,
  lifecycle: manifest.lifecycle,
});
