export const LOCAL_SERVER_ORIGIN = "http://127.0.0.1:8787";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function externalNetworkResources(manifest) {
  return (manifest.contributions ?? [])
    .flatMap((contribution) => contribution.authorization?.effects ?? [])
    .filter((effect) => effect.kind === "external-network")
    .flatMap((effect) => effect.resources ?? []);
}

function isLoopbackResource(resource) {
  if (typeof resource !== "string") return false;
  try {
    const hostname = new URL(resource).hostname;
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

/** Derive the local descriptor without mutating the production descriptor. */
export function deriveLocalPackageManifest(canonicalManifest) {
  const canonicalLoopback = externalNetworkResources(canonicalManifest).find(
    isLoopbackResource,
  );
  if (canonicalLoopback) {
    throw new Error(
      `The production manifest must not declare loopback network access: ${canonicalLoopback}`,
    );
  }

  const localManifest = cloneJson(canonicalManifest);
  const surface = (localManifest.contributions ?? []).find(
    (contribution) =>
      contribution.kind === "ui.surface" && contribution.id === "kart-royale",
  );
  if (!surface) {
    throw new Error('The Kart Royale ui.surface contribution is missing.');
  }

  const effects = surface.authorization?.effects;
  if (!Array.isArray(effects)) {
    throw new Error('The Kart Royale ui.surface has no authorization effects.');
  }
  const networkEffect = effects.find(
    (effect) => effect.kind === "external-network",
  );
  if (!networkEffect || !Array.isArray(networkEffect.resources)) {
    throw new Error(
      'The Kart Royale ui.surface has no external-network resource list.',
    );
  }

  if (!networkEffect.resources.includes(LOCAL_SERVER_ORIGIN)) {
    networkEffect.resources.push(LOCAL_SERVER_ORIGIN);
  }
  return localManifest;
}
