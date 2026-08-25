/**
 * Vite harness: loads the assembled SDK 0.12 TAP package (dist/) the way a
 * host would — resolve the federation manifest, initialize its remote
 * container, request the desktop expose, then call mount() with a mocked
 * surface context. No TAP runtime is present, so host-backed APIs remain
 * unavailable and the app must render its supported standalone state.
 */

interface FederationContainer {
  init(shareScope: Record<string, unknown>): void | Promise<void>;
  get(expose: string): Promise<() => unknown>;
}

interface DesktopSurfaceModule {
  mount(
    container: HTMLElement,
    context: Record<string, unknown>,
  ): { unmount(): void };
}

function status(message: string, isError = false) {
  const el = document.getElementById("harness-status");
  if (!el) return;
  el.textContent = message;
  el.style.background = isError ? "#fee2e2" : "#d1fae5";
  el.style.color = isError ? "#991b1b" : "#065f46";
}

async function main() {
  const manifest = (await (await fetch("/manifest.tap.json")).json()) as {
    schemaVersion: number;
    versionLabel: string;
    localDisplay?: { slug?: string };
  };
  if (manifest.schemaVersion !== 1) {
    throw new Error("built package is not an SDK 0.12 source manifest");
  }
  const mf = (await (await fetch("/targets/desktop/mf-manifest.json")).json()) as {
    metaData: {
      remoteEntry: { name: string; path: string };
    };
    exposes: Array<{ name: string; path: string }>;
  };

  const expose = mf.exposes.find((candidate) => candidate.name === "ui/desktop");
  if (!expose) throw new Error("ui/desktop expose missing — run pnpm build first");

  const remoteEntryPath = [mf.metaData.remoteEntry.path, mf.metaData.remoteEntry.name]
    .filter(Boolean)
    .join("/");
  if (!remoteEntryPath) throw new Error("desktop remote entry missing from federation manifest");

  const remote = (await import(
    /* @vite-ignore */ `/${remoteEntryPath}`
  )) as FederationContainer;
  if (typeof remote.init !== "function" || typeof remote.get !== "function") {
    throw new Error("desktop remote entry is not a Module Federation container");
  }
  await remote.init({});
  const createSurfaceModule = await remote.get(expose.path);
  const mod = createSurfaceModule() as DesktopSurfaceModule;
  if (typeof mod.mount !== "function") {
    throw new Error("ui/desktop expose does not export mount()");
  }

  const noop = () => () => undefined;
  const context = {
    // Generation-2 source manifests intentionally contain no Registry-owned
    // package/release identity. A real host injects those minted values.
    packageId: "harness-package",
    packageNamespace: manifest.localDisplay?.slug ?? "model-arena",
    releaseId: `harness-release-${manifest.versionLabel}`,
    installationId: "harness-installation",
    contributionId: "model-arena",
    instanceId: "harness-instance",
    hostOrigin: window.location.origin,
    packageAssetBaseUrl: `${window.location.origin}/`,
    userId: "harness-user",
    workspaceId: "harness-workspace",
    conversationId: "harness-conversation",
    events: { publish: () => undefined, subscribe: noop },
    entropy: { randomUUID: () => crypto.randomUUID() },
    hostAuthority: { getSnapshot: () => true, subscribe: noop },
    owner: { getSnapshot: () => null, subscribe: noop },
  };

  const root = document.getElementById("root");
  if (!root) throw new Error("root missing");
  mod.mount(root, context);
  status("miniapp mounted from the built Module Federation package");
}

main().catch((error) => {
  status(`harness failed: ${error instanceof Error ? error.message : String(error)}`, true);
  console.error(error);
});
