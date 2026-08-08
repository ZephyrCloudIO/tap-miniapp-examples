import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  deriveLocalPackageManifest,
  LOCAL_SERVER_ORIGIN,
} from "./local-package-profile.mjs";

const manifestPath = fileURLToPath(new URL("../manifest.tap.json", import.meta.url));

async function canonicalManifest() {
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

function networkEffect(manifest) {
  const surface = manifest.contributions.find(
    (contribution) =>
      contribution.kind === "ui.surface" && contribution.id === "kart-royale",
  );
  return surface.authorization.effects.find(
    (effect) => effect.kind === "external-network",
  );
}

function networkResources(manifest) {
  return networkEffect(manifest).resources;
}

test("local package derivation adds only the exact Wrangler origin", async () => {
  const canonical = await canonicalManifest();
  const before = structuredClone(canonical);

  const local = deriveLocalPackageManifest(canonical);

  assert.deepEqual(canonical, before);
  assert.deepEqual(networkResources(local), [
    ...networkResources(before),
    LOCAL_SERVER_ORIGIN,
  ]);

  const expected = structuredClone(before);
  networkEffect(expected).resources.push(LOCAL_SERVER_ORIGIN);
  assert.deepEqual(local, expected);
});

test("local package derivation rejects loopback access in production", async () => {
  const canonical = await canonicalManifest();
  networkEffect(canonical).resources.push("http://localhost:8787");

  assert.throws(
    () => deriveLocalPackageManifest(canonical),
    /production manifest must not declare loopback network access/u,
  );
});
