import manifest from "./manifest.tap.json" with { type: "json" };
import { defineTapMiniapp } from "@theaiplatform/miniapp-sdk/authoring";
import { commandTargetBuilder } from "@theaiplatform/miniapp-sdk/lifecycle";
import { zephyrPublisher } from "@zephyrcloudio/miniapp-zephyr-publisher";
import { staticContributionProvider } from "../../scripts/tap-miniapp-static-contributions.mjs";
import { verifyReactClosure } from "./scripts/verify-react-closure.mjs";

const builder = commandTargetBuilder({
  command: "pnpm",
  args: ["exec", "rslib", "build"],
});

export default defineTapMiniapp({
  publisher: zephyrPublisher({
    coordinates: {
      organization: "zephyrcloudio",
      project: "tap-miniapp-examples",
      application: "model-arena",
    },
  }),
  versionLabel: manifest.release.version,
  presentation: {
    ...manifest.presentation,
    slug: "model-arena",
    categories: ["other"],
  },
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
  },
  contributions: [staticContributionProvider(manifest)],
  dependencySlots: [],
  events: manifest.events,
  runtimePolicy: manifest.lifecycle,
  verify: {
    verifyRuntime: ({ packageRoot }) => verifyReactClosure(packageRoot),
  },
});
