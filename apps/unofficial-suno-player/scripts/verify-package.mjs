import fs from "node:fs";
import path from "node:path";
import { assertPortableTapPackageArtifacts } from "@theaiplatform/miniapp-sdk/rspack";

const packageRoot = new URL("../tap-package", import.meta.url).pathname;
const sourceRoot = new URL("..", import.meta.url).pathname;
const manifestPath = path.join(packageRoot, "manifest.tap.json");

if (!fs.existsSync(manifestPath)) throw new Error("TAP package manifest is missing; run build:miniapp first.");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const required = [
  manifest.targets?.desktop?.remoteEntry,
  manifest.targets?.desktop?.manifest,
  manifest.targets?.desktop?.assetLock,
].filter(Boolean).map((file) => path.join(packageRoot, file));

for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Required desktop package artifact is missing: ${file}`);
}

const serialized = JSON.stringify(manifest);
if (serialized.includes('"pending"')) throw new Error("Assembled package still contains pending integrity values.");
if (manifest.compatibility?.tapSdk !== "0.0.1") throw new Error("Assembled package TAP SDK compatibility is not exactly 0.0.1.");

await assertPortableTapPackageArtifacts({ output: packageRoot, forbiddenRoots: [sourceRoot] });
console.log(`verified ${required.length} desktop artifacts, resolved integrity, SDK compatibility, and portability`);
