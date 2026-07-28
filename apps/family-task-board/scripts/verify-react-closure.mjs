import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = resolve(appRoot, ".tap-build/desktop");
const targetRoot = join(packageRoot, "targets/desktop");
const federationManifest = JSON.parse(
  await readFile(join(targetRoot, "mf-manifest.json"), "utf8"),
);

const javascriptAssets = new Set(
  (federationManifest.exposes ?? []).flatMap((expose) => [
    ...(expose.assets?.js?.sync ?? []),
    ...(expose.assets?.js?.async ?? []),
  ]),
);

if (javascriptAssets.size === 0) {
  throw new Error("Family Task Board has no federated JavaScript assets.");
}

const reactHookDispatcherPattern =
  /\.useRef=function\([^)]*\)\{return [A-Za-z_$][\w$]*\.H\.useRef\(/gu;
let reactRuntimeCount = 0;

for (const asset of javascriptAssets) {
  const source = await readFile(join(packageRoot, asset), "utf8");
  reactRuntimeCount += [...source.matchAll(reactHookDispatcherPattern)].length;
}

if (reactRuntimeCount !== 1) {
  throw new Error(
    `Family Task Board must contain exactly one React hook runtime; found ${reactRuntimeCount}. ` +
      "Duplicate runtimes leave SDK UI hooks attached to an inactive dispatcher.",
  );
}

console.log(
  `verified one React hook runtime across ${javascriptAssets.size} federated JavaScript asset(s)`,
);
