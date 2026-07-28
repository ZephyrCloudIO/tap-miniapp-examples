import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSingleReactHookRuntime } from "./react-closure.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = resolve(appRoot, ".tap-build/desktop");
const targetRoot = join(packageRoot, "targets/desktop");
const federationManifest = JSON.parse(
  await readFile(join(targetRoot, "mf-manifest.json"), "utf8"),
);

const sharedNames = (federationManifest.shared ?? []).map((entry) =>
  typeof entry === "string" ? entry : entry?.name,
);
for (const dependency of ["react", "react-dom"]) {
  if (sharedNames.includes(dependency)) {
    throw new Error(
      `Vanta Companion must bundle one private ${dependency} runtime; TAP initializes package Federation containers with an empty share scope.`,
    );
  }
}

const javascriptAssets = new Set(
  (federationManifest.exposes ?? []).flatMap((expose) => [
    ...(expose.assets?.js?.sync ?? []),
    ...(expose.assets?.js?.async ?? []),
  ]),
);
if (javascriptAssets.size === 0) {
  throw new Error("Vanta Companion has no federated JavaScript assets.");
}

const sources = await Promise.all(
  [...javascriptAssets].map((asset) =>
    readFile(join(packageRoot, asset), "utf8"),
  ),
);
assertSingleReactHookRuntime(sources);

console.log(
  `verified one private React hook runtime across ${javascriptAssets.size} federated JavaScript asset(s)`,
);
