import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPortableTapPackageArtifacts } from "@theaiplatform/miniapp-sdk/rspack";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const assembledRoot = path.join(packageRoot, "tap-package");
const manifestPath = path.join(assembledRoot, "manifest.tap.json");

if (!fs.existsSync(manifestPath)) {
  throw new Error("TAP package manifest is missing; run build:miniapp first.");
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const requiredTargets = ["desktop", "quickjs", "workflow-host"];
const requiredArtifacts = requiredTargets.flatMap((targetName) => {
  const target = manifest.targets?.[targetName];
  if (!target) throw new Error(`Assembled package is missing ${targetName}.`);
  return [target.remoteEntry, target.manifest, target.assetLock]
    .filter(Boolean)
    .map((file) => path.join(assembledRoot, file));
});

for (const file of requiredArtifacts) {
  if (!fs.existsSync(file)) {
    throw new Error(`Required package artifact is missing: ${file}`);
  }
}

for (const schema of [
  "empty-config.schema.json",
  "booking-created-input.schema.json",
  "booking-cancelled-input.schema.json",
  "normalized-booking.schema.json",
  "work-block-request.schema.json",
  "work-block-draft.schema.json",
  "channel-summary.schema.json",
]) {
  const file = path.join(
    assembledRoot,
    "targets/workflow-host/schemas",
    schema,
  );
  if (!fs.existsSync(file)) {
    throw new Error(`Required workflow schema is missing: ${file}`);
  }
}

const serialized = JSON.stringify(manifest);
if (serialized.includes('"pending"')) {
  throw new Error("Assembled package still contains pending integrity values.");
}
if (manifest.compatibility?.tapSdk !== "0.8.0") {
  throw new Error("Assembled TAP SDK compatibility is not exactly 0.8.0.");
}

await assertPortableTapPackageArtifacts({
  output: assembledRoot,
  forbiddenRoots: [packageRoot],
});
console.log(
  `Verified ${requiredArtifacts.length} artifacts across three targets, seven workflow schemas, resolved integrity, SDK compatibility, and portability.`,
);
