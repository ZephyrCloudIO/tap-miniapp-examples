import { assembleTapPackage, assertPortableTapPackageArtifacts } from "@theaiplatform/miniapp-sdk/rspack";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../tap-package", import.meta.url));
const sourceRoot = fileURLToPath(new URL("..", import.meta.url));

await assembleTapPackage({
  manifest: fileURLToPath(new URL("../manifest.tap.json", import.meta.url)),
  output: packageRoot,
  targets: {
    desktop: fileURLToPath(new URL("../.tap-build/desktop", import.meta.url)),
    "workflow-host": fileURLToPath(new URL("../.tap-build/workflow-host", import.meta.url)),
  },
});

await assertPortableTapPackageArtifacts({ output: packageRoot, forbiddenRoots: [sourceRoot] });
console.log(`assembled portable TAP package at ${packageRoot}`);
