/**
 * Vite harness: loads the *built* TAP package (.tap-build/desktop) the way a
 * host would — resolve the federation manifest, load the expose chunk and its
 * CSS, then call mount() with a mocked surface context. No TAP runtime, so
 * host APIs (vfs/http/credentials/specialist/trr) are absent and the app must
 * degrade to its standalone fallbacks (direct OpenRouter fetch + local key).
 */

interface MfExpose {
  id: string;
  assets?: { js?: { sync?: string[] }; css?: { sync?: string[] } };
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
    package: { packageId: string; namespace: string };
    release: { releaseId: string };
    contributions: Array<{ id: string }>;
  };
  const mf = (await (await fetch("/targets/desktop/mf-manifest.json")).json()) as {
    exposes: MfExpose[];
  };

  const expose = mf.exposes.find((e) => e.id.includes("ui/desktop"));
  const chunk = expose?.assets?.js?.sync?.[0];
  const css = expose?.assets?.css?.sync?.[0];
  if (!chunk) throw new Error("ui/desktop expose chunk missing — run pnpm build first");

  if (css) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `/${css}`;
    document.head.appendChild(link);
  }

  const mod = (await import(/* @vite-ignore */ `/${chunk}`)) as {
    mount: (
      container: HTMLElement,
      context: Record<string, unknown>,
    ) => { unmount(): void };
  };

  const noop = () => () => undefined;
  const context = {
    packageId: manifest.package.packageId,
    packageNamespace: manifest.package.namespace,
    releaseId: manifest.release.releaseId,
    installationId: "harness-installation",
    contributionId: manifest.contributions[0]?.id ?? "model-arena",
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
  status("miniapp mounted from built package — host APIs absent, standalone fallbacks active");
}

main().catch((error) => {
  status(`harness failed: ${error instanceof Error ? error.message : String(error)}`, true);
  console.error(error);
});
