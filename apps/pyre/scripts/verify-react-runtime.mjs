import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const desktopRoot = path.join(
  packageRoot,
  ".tap-package",
  "targets",
  "desktop",
);
const manifestPath = path.join(desktopRoot, "mf-manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

const sharedNames = (manifest.shared ?? []).map((entry) =>
  typeof entry === "string" ? entry : entry?.name,
);
for (const dependency of ["react", "react-dom"]) {
  if (sharedNames.includes(dependency)) {
    throw new Error(
      `Pyre must bundle one private ${dependency} runtime; TAP initializes package Federation containers with an empty share scope.`,
    );
  }
}

const desktopExpose = (manifest.exposes ?? []).find(
  (entry) => entry?.path === "./ui/desktop",
);
const javaScriptAssets = desktopExpose?.assets?.js?.sync;
if (!Array.isArray(javaScriptAssets) || javaScriptAssets.length === 0) {
  throw new Error("Pyre's desktop expose has no synchronous JavaScript asset.");
}

const sources = await Promise.all(
  javaScriptAssets.map((asset) =>
    fs.readFile(path.join(packageRoot, ".tap-package", asset), "utf8"),
  ),
);
const source = sources.join("\n");
const reactRuntimeDefinitions = source.match(
  /\.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE=/gu,
);
const reactDomRuntimeDefinitions = source.match(
  /\.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE=/gu,
);

if (reactRuntimeDefinitions?.length !== 1) {
  throw new Error(
    `Pyre's desktop expose must contain exactly one React runtime; found ${reactRuntimeDefinitions?.length ?? 0}.`,
  );
}
if (reactDomRuntimeDefinitions?.length !== 1) {
  throw new Error(
    `Pyre's desktop expose must contain exactly one React DOM runtime; found ${reactDomRuntimeDefinitions?.length ?? 0}.`,
  );
}

console.log("verified one private React/React DOM runtime in Pyre's desktop expose");
