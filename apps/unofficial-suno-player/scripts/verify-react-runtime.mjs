import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(appRoot, "tap-package");
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
      `Unofficial Suno Player must bundle one private ${dependency} runtime; TAP initializes package Federation containers with an empty share scope.`,
    );
  }
}

const desktopExpose = (federationManifest.exposes ?? []).find(
  (entry) => entry?.path === "./ui/desktop",
);
const javascriptAssets = [
  ...(desktopExpose?.assets?.js?.sync ?? []),
  ...(desktopExpose?.assets?.js?.async ?? []),
];
if (javascriptAssets.length === 0) {
  throw new Error(
    "Unofficial Suno Player's desktop expose has no JavaScript assets.",
  );
}

const source = (
  await Promise.all(
    javascriptAssets.map((asset) =>
      readFile(join(packageRoot, asset), "utf8"),
    ),
  )
).join("\n");

const reactRuntimeCount = [
  ...source.matchAll(
    /\.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE=/gu,
  ),
].length;
const reactDomRuntimeCount = [
  ...source.matchAll(
    /\.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE=/gu,
  ),
].length;

if (reactRuntimeCount !== 1) {
  throw new Error(
    `Unofficial Suno Player's desktop expose must contain exactly one React runtime; found ${reactRuntimeCount}.`,
  );
}
if (reactDomRuntimeCount !== 1) {
  throw new Error(
    `Unofficial Suno Player's desktop expose must contain exactly one React DOM runtime; found ${reactDomRuntimeCount}.`,
  );
}

console.log(
  "verified one private React/React DOM runtime in Unofficial Suno Player's desktop expose",
);
