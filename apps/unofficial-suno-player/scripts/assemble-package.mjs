import { assembleTapPackage, assertPortableTapPackageArtifacts } from "@theaiplatform/miniapp-sdk/rspack";

const packageRoot = new URL("../tap-package", import.meta.url).pathname;
const sourceRoot = new URL("..", import.meta.url).pathname;

await assembleTapPackage({
  manifest: new URL("../manifest.tap.json", import.meta.url).pathname,
  output: packageRoot,
  targets: {
    desktop: new URL("../.tap-build/desktop", import.meta.url).pathname,
    "workflow-host": new URL("../.tap-build/workflow-host", import.meta.url).pathname,
  },
});

await assertPortableTapPackageArtifacts({ output: packageRoot, forbiddenRoots: [sourceRoot] });
console.log(`assembled portable TAP package at ${packageRoot}`);
