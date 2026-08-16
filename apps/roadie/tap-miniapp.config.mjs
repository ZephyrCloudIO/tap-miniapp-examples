import manifest from "./manifest.tap.json" with { type: "json" };
import { defineTapMiniapp } from "@theaiplatform/miniapp-sdk/authoring";
import { definePlatformSessionBackend } from "@theaiplatform/miniapp-sdk/auth";
import { commandTargetBuilder } from "@theaiplatform/miniapp-sdk/lifecycle";
import { ROADIE_PLATFORM_SESSION_BACKEND } from "@tap-examples/roadie-contract/platform-session";
import { staticContributionProvider } from "../../scripts/tap-miniapp-static-contributions.mjs";

const roadieBackend = definePlatformSessionBackend(
  ROADIE_PLATFORM_SESSION_BACKEND,
);
const roadieSurface = manifest.contributions.find(
  (contribution) => contribution.kind === "ui.surface" && contribution.id === "roadie",
);
if (
  !roadieSurface?.authorization?.effects.some(
    (effect) =>
      effect.kind === "credentials" &&
      effect.resources.includes(roadieBackend.credentialRef),
  )
) {
  throw new Error(
    "Roadie manifest must declare the SDK-generated platform session credential",
  );
}

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
  },
  contributions: [staticContributionProvider(manifest)],
  events: manifest.events,
  lifecycle: manifest.lifecycle,
});
