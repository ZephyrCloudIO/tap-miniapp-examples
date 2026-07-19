import fs from "node:fs";
import path from "node:path";
import { assertPortableTapPackageArtifacts } from "@theaiplatform/miniapp-sdk/rspack";

const packageRoot = new URL("../tap-package", import.meta.url).pathname;
const sourceRoot = new URL("..", import.meta.url).pathname;
const manifestPath = path.join(packageRoot, "manifest.tap.json");

if (!fs.existsSync(manifestPath)) throw new Error("TAP package manifest is missing; run build:miniapp first.");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const requiredTargets = ["desktop", "workflow-host"];
const required = requiredTargets.flatMap((targetName) => {
  const target = manifest.targets?.[targetName];
  if (!target) throw new Error(`Assembled package is missing its ${targetName} target.`);
  return [target.remoteEntry, target.manifest, target.assetLock]
    .filter(Boolean)
    .map((file) => path.join(packageRoot, file));
});

for (const file of required) if (!fs.existsSync(file)) throw new Error(`Required package artifact is missing: ${file}`);

for (const schema of [
  "targets/workflow-host/schemas/manual-brief-workflow.schema.json",
  "targets/workflow-host/schemas/manual-brief-node-config.schema.json",
]) {
  if (!fs.existsSync(path.join(packageRoot, schema))) throw new Error(`Required workflow schema is missing: ${schema}`);
}

const serialized = JSON.stringify(manifest);
if (serialized.includes('"pending"')) throw new Error("Assembled package still contains pending integrity values.");
if (manifest.compatibility?.tapSdk !== "0.2.0") throw new Error("Assembled package TAP SDK compatibility is not exactly 0.2.0.");

await assertPortableTapPackageArtifacts({ output: packageRoot, forbiddenRoots: [sourceRoot] });
console.log(`verified ${required.length} artifacts across ${requiredTargets.length} targets, workflow schemas, resolved integrity, SDK compatibility, and portability`);
