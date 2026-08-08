import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assembleTapPackage,
  assertPortableTapPackageArtifacts,
} from "@theaiplatform/miniapp-sdk/rspack";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const output = path.join(packageRoot, "dist");
const manifest = process.env.TAP_PACKAGE_MANIFEST?.trim()
  ? path.resolve(packageRoot, process.env.TAP_PACKAGE_MANIFEST.trim())
  : path.join(packageRoot, "manifest.tap.json");

await assembleTapPackage({
  manifest,
  output,
  targets: {
    desktop: path.join(packageRoot, ".tap-build/desktop"),
    quickjs: path.join(packageRoot, ".tap-build/quickjs"),
  },
});

await assertPortableTapPackageArtifacts({
  output,
  forbiddenRoots: [packageRoot],
});

console.log(`Assembled portable TAP package at ${output}`);
